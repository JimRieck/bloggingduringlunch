// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers post_views, post_ratings (+ post_rating_summary), and
// post_comments (+ public_profiles) from
// supabase/migrations/20260907154630_add_post_engagement.sql: reading
// is open to everyone, writing requires login, and re-rating a post
// updates the existing row instead of erroring -- the exact upsert
// onConflict bug caught in manual testing before this ever shipped,
// now pinned down so it can't silently come back. Also covers
// 20260908203258_exclude_author_from_post_views.sql: a post's own
// author can't inflate its view count.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestData, createTestClient } from '../helpers/testClients.js'

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

describe('post engagement: views, ratings, comments', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let authorClient
  let authorId
  let orgId
  let postId
  let readerClient
  let readerId
  let strangerClient

  beforeAll(async () => {
    authorClient = createTestClient()
    const { user } = await signUp(authorClient, emailFor('engage-author'), {
      username: 'engage-author-' + runId,
      user_type: 'author',
      new_organization_name: 'Engagement Org ' + runId,
    })
    authorId = user.id

    const { data: membership } = await authorClient
      .from('memberships')
      .select('organizations(id)')
      .eq('user_id', authorId)
      .single()
    orgId = membership.organizations.id
    createdOrgIds.push(orgId)

    const { data: post } = await authorClient
      .from('posts')
      .insert({
        organization_id: orgId,
        author_id: authorId,
        title: 'Engagement Test Post ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    postId = post.id

    readerClient = createTestClient()
    const { user: reader } = await signUp(readerClient, emailFor('engage-reader'), {
      username: 'engage-reader-' + runId,
      user_type: 'reader',
    })
    readerId = reader.id

    strangerClient = createTestClient()
    await signUp(strangerClient, emailFor('engage-stranger'), {
      username: 'engage-stranger-' + runId,
      user_type: 'reader',
    })
  })

  describe('views', () => {
    it('anyone, even signed out, can record a view on a published post', async () => {
      const anonClient = createTestClient()
      const { error } = await anonClient.from('post_views').insert({ post_id: postId, referrer: null })
      expect(error).toBeNull()
    })

    it("does not let the post's own author record a view on it", async () => {
      const { error } = await authorClient.from('post_views').insert({ post_id: postId, referrer: null })
      expect(error).toBeTruthy()
    })

    it('still counts a view from a different logged-in reader on the same post', async () => {
      const { error } = await readerClient.from('post_views').insert({ post_id: postId, referrer: null })
      expect(error).toBeNull()
    })

    it("can't record a view against a draft post", async () => {
      const { data: draft } = await authorClient
        .from('posts')
        .insert({
          organization_id: orgId,
          author_id: authorId,
          title: 'Unpublished Engagement Post ' + runId,
          content: '<p>content</p>',
          status: 'draft',
          published_at: null,
        })
        .select('id')
        .single()

      const anonClient = createTestClient()
      const { error } = await anonClient.from('post_views').insert({ post_id: draft.id, referrer: null })
      expect(error).toBeTruthy()
    })

    it('a stranger cannot read the raw view rows -- only the org can', async () => {
      const { data } = await strangerClient.from('post_views').select('id').eq('post_id', postId)
      expect(data).toHaveLength(0)

      const { data: asAuthor } = await authorClient.from('post_views').select('id').eq('post_id', postId)
      expect(asAuthor.length).toBeGreaterThan(0)
    })
  })

  describe('ratings', () => {
    it('logged-out users cannot rate', async () => {
      const anonClient = createTestClient()
      const { error } = await anonClient
        .from('post_ratings')
        .insert({ post_id: postId, user_id: readerId, rating: 5 })
      expect(error).toBeTruthy()
    })

    it('a logged-in user can rate, and re-rating updates instead of duplicating', async () => {
      const { error: firstError } = await readerClient
        .from('post_ratings')
        .upsert({ post_id: postId, user_id: readerId, rating: 3 }, { onConflict: 'post_id,user_id' })
      expect(firstError).toBeNull()

      const { error: secondError } = await readerClient
        .from('post_ratings')
        .upsert({ post_id: postId, user_id: readerId, rating: 5 }, { onConflict: 'post_id,user_id' })
      expect(secondError).toBeNull()

      const { data: rows } = await readerClient
        .from('post_ratings')
        .select('rating')
        .eq('post_id', postId)
        .eq('user_id', readerId)
      expect(rows).toHaveLength(1)
      expect(rows[0].rating).toBe(5)
    })

    it('the public summary view shows the aggregate, readable by anyone', async () => {
      const anonClient = createTestClient()
      const { data, error } = await anonClient
        .from('post_rating_summary')
        .select('average_rating, rating_count')
        .eq('post_id', postId)
        .single()
      expect(error).toBeNull()
      expect(data.rating_count).toBe(1)
      expect(Number(data.average_rating)).toBe(5)
    })

    it("a stranger can't see another reader's individual rating row", async () => {
      const { data } = await strangerClient
        .from('post_ratings')
        .select('id')
        .eq('post_id', postId)
        .eq('user_id', readerId)
      expect(data).toHaveLength(0)
    })
  })

  describe('comments', () => {
    let commentId

    it('logged-out users cannot comment', async () => {
      const anonClient = createTestClient()
      const { error } = await anonClient
        .from('post_comments')
        .insert({ post_id: postId, user_id: readerId, body: 'nope' })
      expect(error).toBeTruthy()
    })

    it('a logged-in user can comment, and anyone can read it back', async () => {
      const { data, error } = await readerClient
        .from('post_comments')
        .insert({ post_id: postId, user_id: readerId, body: 'Great post!' })
        .select('id')
        .single()
      expect(error).toBeNull()
      commentId = data.id

      const anonClient = createTestClient()
      const { data: comments } = await anonClient
        .from('post_comments')
        .select('id, body')
        .eq('post_id', postId)
      expect(comments.some((c) => c.id === commentId)).toBe(true)
    })

    it("public_profiles exposes the commenter's display name but not their email", async () => {
      const anonClient = createTestClient()
      const { data, error } = await anonClient
        .from('public_profiles')
        .select('*')
        .eq('id', readerId)
        .single()
      expect(error).toBeNull()
      expect(data.display_name).toBeTruthy()
      expect(data.email).toBeUndefined()
    })

    it("a stranger can't delete someone else's comment", async () => {
      const { count, error } = await strangerClient
        .from('post_comments')
        .delete({ count: 'exact' })
        .eq('id', commentId)
      expect(error).toBeNull()
      expect(count).toBe(0)
    })

    it("the post's org admin can delete the comment (moderation)", async () => {
      const { count, error } = await authorClient
        .from('post_comments')
        .delete({ count: 'exact' })
        .eq('id', commentId)
      expect(error).toBeNull()
      expect(count).toBe(1)
    })
  })
})
