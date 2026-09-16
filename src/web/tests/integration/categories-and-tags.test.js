// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Covers
// 20260916103000_create_categories_and_tags.sql's RLS shape: categories
// are shared org-wide, tags are private per author even within the same
// org, post_categories can be managed by any org editor (same as posts
// themselves), post_tags can only be managed by a post's own author, and
// both a published post's categories and tags are readable by an
// anonymous visitor (not just an error-free empty embed) while a draft's
// are not.
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
  return confirmSignup(client, email)
}

describe('post categories and tags', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let ownerClient
  let ownerId
  let orgId
  let editorClient
  let strangerClient
  let postId
  let categoryId
  let tagId

  beforeAll(async () => {
    ownerClient = createTestClient()
    const { user: owner } = await signUp(ownerClient, emailFor('taxo-owner'), {
      username: 'taxo-owner-' + runId,
      user_type: 'author',
      new_organization_name: 'Taxonomy Test Org ' + runId,
    })
    ownerId = owner.id
    const { data: ownerMembership } = await ownerClient
      .from('memberships')
      .select('organizations(id, invite_code)')
      .eq('user_id', ownerId)
      .single()
    orgId = ownerMembership.organizations.id
    createdOrgIds.push(orgId)

    // A second editor on the *same* org -- the interesting case for
    // tags, since org membership alone must not be enough to see or
    // manage someone else's tags.
    editorClient = createTestClient()
    await signUp(editorClient, emailFor('taxo-editor'), {
      username: 'taxo-editor-' + runId,
      user_type: 'author',
      invite_code: ownerMembership.organizations.invite_code,
    })

    // An author on a completely unrelated org.
    strangerClient = createTestClient()
    const { user: stranger } = await signUp(strangerClient, emailFor('taxo-stranger'), {
      username: 'taxo-stranger-' + runId,
      user_type: 'author',
      new_organization_name: 'Taxonomy Stranger Org ' + runId,
    })
    const { data: strangerMembership } = await strangerClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', stranger.id)
      .single()
    createdOrgIds.push(strangerMembership.organization_id)

    const { data: post } = await ownerClient
      .from('posts')
      .insert({
        organization_id: orgId,
        author_id: ownerId,
        title: 'Taxonomy Test Post ' + runId,
        content: '<p>content</p>',
        status: 'draft',
      })
      .select('id')
      .single()
    postId = post.id
  })

  it('categories: an org editor can create one, visible to the whole org', async () => {
    const { data: category, error } = await ownerClient
      .from('categories')
      .insert({ organization_id: orgId, name: 'Engineering' })
      .select('id, slug')
      .single()
    expect(error).toBeNull()
    expect(category.slug).toBe('engineering')
    categoryId = category.id

    const { data: seenByEditor } = await editorClient.from('categories').select('id').eq('id', categoryId)
    expect(seenByEditor).toEqual([{ id: categoryId }])

    const { data: seenByStranger } = await strangerClient.from('categories').select('id').eq('id', categoryId)
    expect(seenByStranger).toEqual([])
  })

  it("tags: private to the author, invisible even to an editor on the same org", async () => {
    const { data: tag, error } = await ownerClient
      .from('tags')
      .insert({ author_id: ownerId, name: 'react' })
      .select('id, slug')
      .single()
    expect(error).toBeNull()
    expect(tag.slug).toBe('react')
    tagId = tag.id

    // The whole point of the feature: same org, different author, zero
    // rows -- not an error, matching this project's fail-narrow convention.
    const { data: seenByEditor, error: editorError } = await editorClient
      .from('tags')
      .select('id')
      .eq('id', tagId)
    expect(editorError).toBeNull()
    expect(seenByEditor).toEqual([])
  })

  it('post_categories: any org editor can attach a category to the post, a stranger cannot', async () => {
    const { error: strangerError } = await strangerClient
      .from('post_categories')
      .insert({ post_id: postId, category_id: categoryId })
    expect(strangerError).not.toBeNull()

    const { error: editorError } = await editorClient
      .from('post_categories')
      .insert({ post_id: postId, category_id: categoryId })
    expect(editorError).toBeNull()

    const { data: linked } = await adminClient
      .from('post_categories')
      .select('post_id')
      .eq('post_id', postId)
      .eq('category_id', categoryId)
    expect(linked).toHaveLength(1)
  })

  it("post_tags: only the post's own author can attach a tag, not an org editor", async () => {
    const { error: editorError, count: editorCount } = await editorClient
      .from('post_tags')
      .insert({ post_id: postId, tag_id: tagId }, { count: 'exact' })
    // Rejected either as an RLS error or as a silent zero-row insert,
    // depending on how PostgREST reports a with-check failure -- assert
    // whichever it is, then confirm via the admin client that nothing
    // actually landed either way.
    if (!editorError) {
      expect(editorCount).toBe(0)
    }

    const { error: ownerError } = await ownerClient.from('post_tags').insert({ post_id: postId, tag_id: tagId })
    expect(ownerError).toBeNull()

    const { data: linked } = await adminClient
      .from('post_tags')
      .select('post_id')
      .eq('post_id', postId)
      .eq('tag_id', tagId)
    expect(linked).toHaveLength(1)
  })

  it("a draft's categories and tags are not visible to an anonymous reader", async () => {
    const anonClient = createTestClient()
    const { data: catData } = await anonClient.from('categories').select('id').eq('id', categoryId)
    expect(catData).toEqual([])
    const { data: tagData } = await anonClient.from('tags').select('id').eq('id', tagId)
    expect(tagData).toEqual([])
  })

  it("once published, an anonymous reader can see the post's category and tag names", async () => {
    await ownerClient.from('posts').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', postId)

    const anonClient = createTestClient()
    const { data: catData, error: catError } = await anonClient
      .from('categories')
      .select('id, name')
      .eq('id', categoryId)
    expect(catError).toBeNull()
    expect(catData).toEqual([{ id: categoryId, name: 'Engineering' }])

    const { data: tagData, error: tagError } = await anonClient.from('tags').select('id, name').eq('id', tagId)
    expect(tagError).toBeNull()
    expect(tagData).toEqual([{ id: tagId, name: 'react' }])
  })
})
