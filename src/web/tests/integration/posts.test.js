// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows (requires `npx supabase
// start`, .env.test.local from .env.test.example).
//
// Covers the full post lifecycle a real author goes through: log in,
// create a draft (matching PostForm.jsx's upsert shape, no client-sent
// slug -- the set_post_slug trigger fills it in), publish it, view it
// as an anonymous reader would (proving RLS actually grants public
// access to a published post, not just that the DB row exists), then
// delete it as the owner. Also covers the RLS boundary MyPosts.jsx's
// own comment already documents: a plain editor (not owner/admin)
// can't delete someone else's post even if the button were clicked.
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

describe('post lifecycle: create, publish, view, delete', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let ownerClient
  let ownerId
  let orgId
  let orgSlug
  let postId
  let postSlug

  beforeAll(async () => {
    ownerClient = createTestClient()
    const { user } = await signUp(ownerClient, emailFor('post-owner'), {
      username: 'post-owner-' + runId,
      user_type: 'author',
      new_organization_name: 'Post Lifecycle Org ' + runId,
    })
    ownerId = user.id

    const { data: membership } = await ownerClient
      .from('memberships')
      .select('organizations(id, slug)')
      .eq('user_id', ownerId)
      .single()
    orgId = membership.organizations.id
    orgSlug = membership.organizations.slug
    createdOrgIds.push(orgId)
  })

  it('login: signing back in returns a working session for the same account', async () => {
    const loginClient = createTestClient()
    const { data, error } = await loginClient.auth.signInWithPassword({
      email: emailFor('post-owner'),
      password: PASSWORD,
    })
    expect(error).toBeNull()
    expect(data.session).toBeTruthy()
    expect(data.user.id).toBe(ownerId)
  })

  it('create: saving a new draft auto-generates a slug and belongs to the right org', async () => {
    const { data, error } = await ownerClient
      .from('posts')
      .insert({
        organization_id: orgId,
        author_id: ownerId,
        title: 'My First IT Career Post',
        content: '<p>Draft content.</p>',
        status: 'draft',
        published_at: null,
      })
      .select('id, slug, status')
      .single()

    expect(error).toBeNull()
    expect(data.slug).toBe('my-first-it-career-post')
    expect(data.status).toBe('draft')
    postId = data.id
    postSlug = data.slug
  })

  it("create: a draft doesn't appear in anonymous/public queries yet", async () => {
    const anonClient = createTestClient()
    const { data } = await anonClient
      .from('posts')
      .select('id')
      .eq('id', postId)
      .maybeSingle()
    expect(data).toBeNull()
  })

  it('publish: flipping status to published sets it publicly visible', async () => {
    const { error } = await ownerClient
      .from('posts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', postId)
    expect(error).toBeNull()
  })

  it('view: an anonymous reader can load the published post by org slug + post slug', async () => {
    const anonClient = createTestClient()
    const { data, error } = await anonClient
      .from('posts')
      .select('id, title, status')
      .eq('organization_id', orgId)
      .eq('slug', postSlug)
      .eq('status', 'published')
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toMatchObject({ id: postId, title: 'My First IT Career Post', status: 'published' })

    // Same lookup through organizations_public, the way TenantBlog.jsx
    // actually resolves the org slug in the URL before fetching the post.
    const { data: org } = await anonClient
      .from('organizations_public')
      .select('id')
      .eq('slug', orgSlug)
      .maybeSingle()
    expect(org.id).toBe(orgId)
  })

  it("delete: a plain editor (not owner/admin) can't delete someone else's post", async () => {
    const editorClient = createTestClient()
    const { data: ownerOrg } = await ownerClient
      .from('memberships')
      .select('organizations(invite_code)')
      .eq('user_id', ownerId)
      .single()
    await signUp(editorClient, emailFor('post-editor'), {
      username: 'post-editor-' + runId,
      user_type: 'author',
      invite_code: ownerOrg.organizations.invite_code,
    })

    const { count, error } = await editorClient.from('posts').delete({ count: 'exact' }).eq('id', postId)
    expect(error).toBeNull()
    expect(count).toBe(0)

    // Confirm it's really still there, not just that the delete call
    // itself came back quiet.
    const { data: stillThere } = await adminClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(stillThere).toMatchObject({ id: postId })
  })

  it('delete: the owner can actually delete their own post', async () => {
    const { count, error } = await ownerClient.from('posts').delete({ count: 'exact' }).eq('id', postId)
    expect(error).toBeNull()
    expect(count).toBe(1)

    const { data } = await adminClient.from('posts').select('id').eq('id', postId).maybeSingle()
    expect(data).toBeNull()
  })
})
