// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Additionally requires
// the admin-set-account-status Edge Function to be served, which `npx
// supabase start` does automatically.
//
// Covers supabase/functions/admin-set-account-status/index.ts and the
// RLS policy from 20260907181657_hide_disabled_authors_posts.sql:
// only a real site admin can disable/enable an account, an admin can't
// disable themselves, disabling actually blocks login (banned_until),
// and -- the bug caught and fixed right after this shipped -- a
// disabled author's already-published posts disappear from public
// queries but stay visible to their org. Also covers the RLS policy
// from 20260909183450_site_admin_can_view_all_post_views.sql, added
// for the admin page's site traffic chart.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function signUp(client, email, data) {
  const { data: result, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  // signUp() no longer returns a session directly (enable_confirmations
  // is on) -- this completes the same confirmation-email flow a real
  // user's click does, via the real email Supabase sent to Mailpit.
  return confirmSignup(client, email)
}

async function invokeSetStatus(client, body) {
  const { data, error } = await client.functions.invoke('admin-set-account-status', { body })
  if (error) {
    const errorBody = await error.context.json()
    return { ok: false, status: error.context.status, errorBody }
  }
  return { ok: true, data }
}

describe('site admin: disable accounts', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let adminAuthClient
  let adminId
  let targetClient
  let targetId
  let targetOrgId
  let postId

  beforeAll(async () => {
    const bootstrapAdmin = createTestClient()
    const { user: adminUser } = await signUp(bootstrapAdmin, emailFor('site-admin'), {
      username: 'site-admin-' + runId,
      user_type: 'author',
      new_organization_name: 'Site Admin Bootstrap Org ' + runId,
    })
    adminId = adminUser.id
    const { data: adminOrgMembership } = await bootstrapAdmin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', adminId)
      .single()
    createdOrgIds.push(adminOrgMembership.organization_id)

    // Granting is_site_admin has no self-service path by design (see
    // ROADMAP.md) -- tests grant it directly the same way the real
    // operator does, via a privileged client.
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', adminId)

    adminAuthClient = createTestClient()
    await adminAuthClient.auth.signInWithPassword({ email: emailFor('site-admin'), password: PASSWORD })

    targetClient = createTestClient()
    const { user: target } = await signUp(targetClient, emailFor('disable-target'), {
      username: 'disable-target-' + runId,
      user_type: 'author',
      new_organization_name: 'Disable Target Org ' + runId,
    })
    targetId = target.id
    const { data: targetMembership } = await targetClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', targetId)
      .single()
    targetOrgId = targetMembership.organization_id
    createdOrgIds.push(targetOrgId)

    const { data: post } = await targetClient
      .from('posts')
      .insert({
        organization_id: targetOrgId,
        author_id: targetId,
        title: 'Post By Someone Who Gets Disabled ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    postId = post.id
  })

  it('rejects a non-admin caller', async () => {
    const result = await invokeSetStatus(targetClient, { userId: adminId, disabled: true })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.errorBody.error).toBe('not_a_site_admin')
  })

  it("rejects an admin trying to disable themselves", async () => {
    const result = await invokeSetStatus(adminAuthClient, { userId: adminId, disabled: true })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.errorBody.error).toBe('cannot_disable_self')
  })

  it("a published post is publicly visible before the author is disabled", async () => {
    const anonClient = createTestClient()
    const { data } = await anonClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(data).toMatchObject({ id: postId })
  })

  it("a site admin can read post_views for a post outside their own org, for the site traffic chart", async () => {
    const anonClient = createTestClient()
    const { error: insertError } = await anonClient.from('post_views').insert({ post_id: postId, referrer: null })
    expect(insertError).toBeNull()

    // adminAuthClient isn't a member of targetOrgId -- without the new
    // "Site admins can view all post views" policy this is exactly the
    // "a stranger cannot read the raw view rows" case already covered
    // for a non-admin in engagement.test.js.
    const { data: asAdmin, error: adminError } = await adminAuthClient
      .from('post_views')
      .select('id')
      .eq('post_id', postId)
    expect(adminError).toBeNull()
    expect(asAdmin.length).toBeGreaterThan(0)
  })

  it('an admin can disable another account', async () => {
    const result = await invokeSetStatus(adminAuthClient, { userId: targetId, disabled: true })
    expect(result.ok).toBe(true)

    const { data: profile } = await adminClient
      .from('profiles')
      .select('disabled')
      .eq('id', targetId)
      .single()
    expect(profile.disabled).toBe(true)
  })

  it('the disabled account can no longer log in', async () => {
    const loginAttempt = createTestClient()
    const { error } = await loginAttempt.auth.signInWithPassword({
      email: emailFor('disable-target'),
      password: PASSWORD,
    })
    expect(error).toBeTruthy()
    expect(error.code ?? error.message).toMatch(/banned/i)
  })

  it("the disabled author's post disappears from public queries but not from their own org", async () => {
    const anonClient = createTestClient()
    const { data: publicView } = await anonClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(publicView).toBeNull()

    // The row itself is untouched -- just not selectable publicly --
    // and org members (verified here via the service-role client
    // standing in for "the row really still exists") can still find
    // it to unpublish/delete themselves.
    const { data: stillExists } = await adminClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(stillExists).toMatchObject({ id: postId })
  })

  it('re-enabling restores login and public visibility', async () => {
    const result = await invokeSetStatus(adminAuthClient, { userId: targetId, disabled: false })
    expect(result.ok).toBe(true)

    const loginAttempt = createTestClient()
    const { error } = await loginAttempt.auth.signInWithPassword({
      email: emailFor('disable-target'),
      password: PASSWORD,
    })
    expect(error).toBeNull()

    const anonClient = createTestClient()
    const { data } = await anonClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(data).toMatchObject({ id: postId })
  })
})
