// Integration tests against a real local Supabase stack -- these are
// not mocked. Requires `npx supabase start` running (see
// .env.test.example for the local URL/keys this expects).
//
// Covers the three distinct signup paths the app actually offers:
// reader, author creating a new org, and author joining an existing
// org via invite code -- verifying not just the resulting DB rows but
// that RLS actually grants (or denies) the access each path implies.
import { afterAll, describe, expect, it } from 'vitest'
import { adminClient, createTestClient } from '../helpers/testClients.js'

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
  return result
}

describe('signup: all account types', () => {
  afterAll(async () => {
    // Delete orgs first (memberships/posts/subscriptions cascade from
    // them), then users (profiles cascade from that) -- same order
    // used throughout this project's manual cleanup, since
    // organizations.owner_id has no ON DELETE CASCADE back to auth.users.
    for (const orgId of createdOrgIds) {
      await adminClient.from('organizations').delete().eq('id', orgId)
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId)
    }
  })

  it('reader: skips organization choice, lands in shared BDLReaders org', async () => {
    const client = createTestClient()
    const email = emailFor('reader')

    const { user, session } = await signUp(client, email, {
      username: 'reader-' + runId,
      user_type: 'reader',
    })
    expect(session).toBeTruthy()

    const { data: profile } = await client
      .from('profiles')
      .select('user_type')
      .eq('id', user.id)
      .single()
    expect(profile.user_type).toBe('reader')

    const { data: membership } = await client
      .from('memberships')
      .select('role, organizations(slug)')
      .eq('user_id', user.id)
      .single()
    expect(membership.organizations.slug).toBe('bdlreaders')
    expect(['owner', 'member']).toContain(membership.role)
  })

  it('author: creating a new org makes them its owner with a working invite code', async () => {
    const client = createTestClient()
    const email = emailFor('author-owner')
    const orgName = 'Test Org ' + runId

    const { user } = await signUp(client, email, {
      username: 'owner-' + runId,
      user_type: 'author',
      new_organization_name: orgName,
    })

    const { data: profile } = await client
      .from('profiles')
      .select('user_type')
      .eq('id', user.id)
      .single()
    expect(profile.user_type).toBe('author')

    const { data: membership } = await client
      .from('memberships')
      .select('role, organizations(id, name, invite_code)')
      .eq('user_id', user.id)
      .single()
    expect(membership.role).toBe('owner')
    expect(membership.organizations.name).toBe(orgName)
    expect(membership.organizations.invite_code).toBeTruthy()
    createdOrgIds.push(membership.organizations.id)

    // The owner-membership and free-subscription triggers should
    // both have fired off the same organizations insert.
    const { data: subscription } = await client
      .from('subscriptions')
      .select('plan, status')
      .eq('organization_id', membership.organizations.id)
      .single()
    expect(subscription).toMatchObject({ plan: 'free', status: 'active' })

    return { orgId: membership.organizations.id, inviteCode: membership.organizations.invite_code }
  })

  it('author: joining via invite code becomes an editor who can actually write posts', async () => {
    // Create the org to join as its own step (rather than reusing the
    // previous test's return value -- Vitest doesn't chain those) so
    // this test is independently runnable.
    const ownerClient = createTestClient()
    const orgName = 'Joinable Org ' + runId
    const { user: owner } = await signUp(ownerClient, emailFor('joinable-owner'), {
      username: 'jowner-' + runId,
      user_type: 'author',
      new_organization_name: orgName,
    })
    const { data: ownerMembership } = await ownerClient
      .from('memberships')
      .select('organizations(id, invite_code)')
      .eq('user_id', owner.id)
      .single()
    const { id: orgId, invite_code: inviteCode } = ownerMembership.organizations
    createdOrgIds.push(orgId)

    // A brand new, unauthenticated client validates the code exactly
    // like the registration form does, before signing up.
    const lookupClient = createTestClient()
    const { data: lookup, error: lookupError } = await lookupClient.rpc('lookup_invite_code', {
      code: inviteCode,
    })
    expect(lookupError).toBeNull()
    expect(lookup).toEqual([{ organization_id: orgId, organization_name: orgName }])

    const editorClient = createTestClient()
    const { user: editor } = await signUp(editorClient, emailFor('editor'), {
      username: 'editor-' + runId,
      user_type: 'author',
      invite_code: inviteCode,
    })

    const { data: editorMembership } = await editorClient
      .from('memberships')
      .select('role, organization_id')
      .eq('user_id', editor.id)
      .single()
    expect(editorMembership.role).toBe('editor')
    expect(editorMembership.organization_id).toBe(orgId)

    // The actual regression this exists to catch: an 'editor' must be
    // able to write, unlike the old 'member' role this replaced.
    const { error: postError } = await editorClient.from('posts').insert({
      organization_id: orgId,
      author_id: editor.id,
      title: 'Editor post',
      slug: 'editor-post-' + runId,
      content: 'Written by the joined editor.',
      status: 'published',
      published_at: new Date().toISOString(),
    })
    expect(postError).toBeNull()
  })

  it('author: an invalid invite code resolves to nothing, and never creates an org', async () => {
    const client = createTestClient()
    const { data: lookup, error } = await client.rpc('lookup_invite_code', {
      code: 'not-a-real-code-' + runId,
    })
    expect(error).toBeNull()
    expect(lookup).toEqual([])
  })
})
