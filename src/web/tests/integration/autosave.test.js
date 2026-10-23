// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261023100000_post_autosave.sql, behind the post editor's
// auto-save (PostForm.jsx):
//   - a draft's address (slug) follows its title until it's first
//     published, then never changes -- auto-save creates a new post's
//     row mid-title, so a slug fixed at insert would keep the half-typed
//     title forever;
//   - post_pending_edits, the private copy a published post auto-saves
//     to: only the blog's editors can see or write it, readers keep
//     seeing the published version, and the updated_at check auto-save
//     relies on to notice another tab's save.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`

const createdUserIds = []
const createdOrgIds = []

async function signUp(name, data) {
  const client = createTestClient()
  const { data: result, error } = await client.auth.signUp({
    email: emailFor(name),
    password: 'password123',
    options: { data: { username: `${name}-${runId}`, user_type: 'author', ...data } },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  await confirmSignup(client, emailFor(name))
  return { client, id: result.user.id }
}

async function orgOf(author) {
  const { data } = await author.client
    .from('memberships')
    .select('organizations(id, invite_code)')
    .eq('user_id', author.id)
    .single()
  return data.organizations
}

describe('post auto-save', () => {
  let owner
  let editor
  let outsider
  let orgId

  async function newDraft(title) {
    const { data, error } = await owner.client
      .from('posts')
      .insert({ organization_id: orgId, author_id: owner.id, title, content: '<p>Body</p>', status: 'draft' })
      .select('id, slug, updated_at')
      .single()
    if (error) throw error
    return data
  }

  async function slugOf(postId) {
    const { data } = await adminClient.from('posts').select('slug, slug_locked').eq('id', postId).single()
    return data
  }

  beforeAll(async () => {
    owner = await signUp('autosave-owner', { new_organization_name: `Autosave Org ${runId}` })
    const org = await orgOf(owner)
    orgId = org.id
    createdOrgIds.push(orgId)
    editor = await signUp('autosave-editor', { invite_code: org.invite_code })
    outsider = await signUp('autosave-outsider', { new_organization_name: `Autosave Other ${runId}` })
    createdOrgIds.push((await orgOf(outsider)).id)
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('a draft’s address', () => {
    it('follows its title while it has never been published', async () => {
      const post = await newDraft('Shipping on my lu')
      expect(post.slug).toBe('shipping-on-my-lu')

      await owner.client.from('posts').update({ title: 'Shipping on my lunch break' }).eq('id', post.id)
      expect(await slugOf(post.id)).toEqual({ slug: 'shipping-on-my-lunch-break', slug_locked: false })
    })

    it('still gets a number when another post has that address, but never collides with itself', async () => {
      const other = await newDraft('Shipping on my lunch break')
      expect(other.slug).toBe('shipping-on-my-lunch-break-1')

      // Same words, different punctuation: same address it already has.
      await owner.client.from('posts').update({ title: 'Shipping On My Lunch Break!' }).eq('id', other.id)
      expect((await slugOf(other.id)).slug).toBe('shipping-on-my-lunch-break-1')
    })

    it('is fixed from the first publish on, even after unpublishing and retitling', async () => {
      const post = await newDraft('Before publishing')
      await owner.client
        .from('posts')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', post.id)
      expect(await slugOf(post.id)).toEqual({ slug: 'before-publishing', slug_locked: true })

      await owner.client.from('posts').update({ title: 'Retitled while live' }).eq('id', post.id)
      expect((await slugOf(post.id)).slug).toBe('before-publishing')

      await owner.client.from('posts').update({ status: 'draft', published_at: null }).eq('id', post.id)
      await owner.client.from('posts').update({ title: 'Retitled as a draft' }).eq('id', post.id)
      expect(await slugOf(post.id)).toEqual({ slug: 'before-publishing', slug_locked: true })
    })

    it('can’t be unlocked by writing the column directly', async () => {
      const post = await newDraft('Locked one')
      await owner.client.from('posts').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', post.id)
      await owner.client.from('posts').update({ slug_locked: false, title: 'Sneaky retitle' }).eq('id', post.id)
      expect(await slugOf(post.id)).toEqual({ slug: 'locked-one', slug_locked: true })
    })

    it('is locked straight away for a post published on its first save', async () => {
      const { data } = await owner.client
        .from('posts')
        .insert({
          organization_id: orgId,
          author_id: owner.id,
          title: 'Straight to live',
          content: '<p>Body</p>',
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      expect(await slugOf(data.id)).toEqual({ slug: 'straight-to-live', slug_locked: true })
    })
  })

  describe('a published post’s pending copy', () => {
    let postId
    let pendingVersion

    beforeAll(async () => {
      const { data } = await owner.client
        .from('posts')
        .insert({
          organization_id: orgId,
          author_id: owner.id,
          title: 'Live title',
          content: '<p>Live body</p>',
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      postId = data.id
    })

    it('the author can save one', async () => {
      const { data, error } = await owner.client
        .from('post_pending_edits')
        .insert({ post_id: postId, title: 'Work in progress', content: '<p>New body</p>', description: 'Soon' })
        .select('updated_at')
        .single()
      expect(error).toBeNull()
      pendingVersion = data.updated_at
    })

    it('readers keep seeing the published version, and can’t see the pending copy', async () => {
      const anon = createTestClient()
      const { data: live } = await anon.from('posts').select('title, content').eq('id', postId).single()
      expect(live).toEqual({ title: 'Live title', content: '<p>Live body</p>' })

      const { data: pending } = await anon.from('post_pending_edits').select('post_id').eq('post_id', postId)
      expect(pending ?? []).toEqual([])
    })

    it('another blog’s author can’t see it or write one', async () => {
      const { data } = await outsider.client.from('post_pending_edits').select('post_id').eq('post_id', postId)
      expect(data).toEqual([])

      const { error } = await outsider.client
        .from('post_pending_edits')
        .update({ title: 'Hijacked' })
        .eq('post_id', postId)
        .select('post_id')
      expect(error).toBeNull()
      const { data: still } = await adminClient.from('post_pending_edits').select('title').eq('post_id', postId).single()
      expect(still.title).toBe('Work in progress')
    })

    it('an editor of the same blog can see and update it', async () => {
      const { data } = await editor.client.from('post_pending_edits').select('title').eq('post_id', postId).single()
      expect(data.title).toBe('Work in progress')

      const { data: updated, error } = await editor.client
        .from('post_pending_edits')
        .update({ title: 'Edited by the editor' })
        .eq('post_id', postId)
        .eq('updated_at', pendingVersion)
        .select('updated_at')
      expect(error).toBeNull()
      expect(updated).toHaveLength(1)
      expect(updated[0].updated_at).not.toBe(pendingVersion)
    })

    it('a save based on an older version updates nothing -- how auto-save notices another tab', async () => {
      const { data, error } = await owner.client
        .from('post_pending_edits')
        .update({ title: 'Stale tab' })
        .eq('post_id', postId)
        .eq('updated_at', pendingVersion)
        .select('updated_at')
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('there’s only ever one per post', async () => {
      const { error } = await owner.client
        .from('post_pending_edits')
        .insert({ post_id: postId, title: 'Second copy', content: '' })
      expect(error?.code).toBe('23505')
    })

    it('keeps to the same 150-character description limit as posts', async () => {
      const { error } = await owner.client
        .from('post_pending_edits')
        .update({ description: 'd'.repeat(151) })
        .eq('post_id', postId)
      expect(error).not.toBeNull()
    })

    it('goes with the post when it’s deleted', async () => {
      await owner.client.from('posts').delete().eq('id', postId)
      const { data } = await adminClient.from('post_pending_edits').select('post_id').eq('post_id', postId)
      expect(data).toEqual([])
    })
  })

  it('a draft’s own save is checked against updated_at the same way', async () => {
    const post = await newDraft('Version check')
    const { data: first } = await owner.client
      .from('posts')
      .update({ content: '<p>Tab one</p>' })
      .eq('id', post.id)
      .eq('updated_at', post.updated_at)
      .select('updated_at')
    expect(first).toHaveLength(1)

    const { data: stale } = await owner.client
      .from('posts')
      .update({ content: '<p>Tab two, stale</p>' })
      .eq('id', post.id)
      .eq('updated_at', post.updated_at)
      .select('updated_at')
    expect(stale).toEqual([])
  })
})
