// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// The app's Zustand stores (src/stores/), each built with a real
// signed-in test client instead of the app's own, so what's checked is
// what the app gets back from the database through RLS -- not a mock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAccountStore } from '../../src/stores/accountStore.js'
import { createAuthStore } from '../../src/stores/authStore.js'
import { createFeatureFlagsStore } from '../../src/stores/featureFlagsStore.js'
import { NO_CATEGORIES, createTaxonomyStore } from '../../src/stores/taxonomyStore.js'
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

async function waitFor(check, timeoutMs = 10_000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

describe('stores', () => {
  let owner
  let editor
  let org

  beforeAll(async () => {
    owner = await signUp('store-owner', { new_organization_name: `Store Org ${runId}` })
    const { data } = await owner.client
      .from('memberships')
      .select('organizations(id, name, slug, invite_code)')
      .eq('user_id', owner.id)
      .single()
    org = data.organizations
    createdOrgIds.push(org.id)
    editor = await signUp('store-editor', { invite_code: org.invite_code })
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('account store', () => {
    it('loads an owner’s profile and blog, answering all three org questions from one list', async () => {
      const store = createAccountStore(owner.client)
      await store.getState().load(owner.id)
      const s = store.getState()

      expect(s.profile).toMatchObject({ avatar_url: null, profile_setup_dismissed: false, disabled: false })
      expect(s.profile).not.toHaveProperty('is_site_admin')
      expect(s.isSiteAdmin).toBe(false)
      const expected = { id: org.id, name: org.name, slug: org.slug, role: 'owner' }
      expect(s.ownedOrgId).toBe(org.id)
      expect(s.authorOrg).toEqual(expected)
      expect(s.orgAdmin).toEqual(expected)
    })

    it('an editor gets the blog to write in, but not to invite to or rename', async () => {
      const store = createAccountStore(editor.client)
      await store.getState().load(editor.id)
      const s = store.getState()
      expect(s.authorOrg).toEqual({ id: org.id, name: org.name, slug: org.slug, role: 'editor' })
      expect(s.ownedOrgId).toBeNull()
      expect(s.orgAdmin).toBeNull()
    })

    it('knows a site admin', async () => {
      await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', editor.id)
      const store = createAccountStore(editor.client)
      await store.getState().load(editor.id)
      expect(store.getState().isSiteAdmin).toBe(true)
      await adminClient.from('profiles').update({ is_site_admin: false }).eq('id', editor.id)
    })

    it('renaming the blog updates every place it appears at once', async () => {
      const store = createAccountStore(owner.client)
      await store.getState().load(owner.id)
      store.getState().renameOrg(org.id, 'Renamed Blog')
      const s = store.getState()
      expect(s.authorOrg.name).toBe('Renamed Blog')
      expect(s.orgAdmin.name).toBe('Renamed Blog')
      expect(s.memberships[0].organization.name).toBe('Renamed Blog')
    })

    it('a profile change leaves the org objects as they were, so components reading them don’t re-render', async () => {
      const store = createAccountStore(owner.client)
      await store.getState().load(owner.id)
      const before = store.getState()
      store.getState().updateProfile({ avatar_url: 'https://example.com/me.png' })
      const after = store.getState()
      expect(after.profile.avatar_url).toBe('https://example.com/me.png')
      expect(after.authorOrg).toBe(before.authorOrg)
      expect(after.orgAdmin).toBe(before.orgAdmin)
    })

    it('a load that finishes after sign-out doesn’t bring the old account back', async () => {
      const store = createAccountStore(owner.client)
      const loading = store.getState().load(owner.id)
      store.getState().clear()
      await loading
      const s = store.getState()
      expect(s.userId).toBeNull()
      expect(s.profile).toBeNull()
      expect(s.authorOrg).toBeUndefined()
    })
  })

  describe('auth store', () => {
    it('picks up the current session, and signs a disabled account out with a notice', async () => {
      const client = createTestClient()
      // A separate signed-in client, so signing it out doesn't affect the
      // other tests' clients.
      const { error } = await client.auth.setSession((await owner.client.auth.getSession()).data.session)
      expect(error).toBeNull()

      const store = createAuthStore(client)
      const stop = store.getState().start()
      await waitFor(() => store.getState().session !== null)
      expect(store.getState().session.user.id).toBe(owner.id)

      await store.getState().signOutDisabled()
      await waitFor(() => store.getState().session === null)
      expect(store.getState().disabledNotice).toBe(true)
      stop()
    })
  })

  describe('taxonomy store', () => {
    async function categoryRows(name) {
      const { data } = await adminClient.from('categories').select('id').eq('organization_id', org.id).ilike('name', name)
      return data
    }

    it('loads the author’s tags and each blog’s categories, sorted by name', async () => {
      await owner.client.from('categories').insert([
        { organization_id: org.id, name: 'Zebra' },
        { organization_id: org.id, name: 'Apple' },
      ])
      await owner.client.from('tags').insert([
        { author_id: owner.id, name: 'yaml' },
        { author_id: owner.id, name: 'bash' },
      ])
      const store = createTaxonomyStore(owner.client)
      await Promise.all([store.getState().loadTags(owner.id), store.getState().loadCategories(org.id)])
      expect(store.getState().tags.map((t) => t.name)).toEqual(['bash', 'yaml'])
      expect(store.getState().categoriesByOrg[org.id].map((c) => c.name)).toEqual(['Apple', 'Zebra'])
    })

    it('a name created earlier in a loop is reused, never created twice -- the old bulk auto-tag duplicate bug', async () => {
      const store = createTaxonomyStore(owner.client)
      await store.getState().loadCategories(org.id)
      const ids = []
      // One call per "post", back to back, as importing and bulk auto-tag do.
      for (const names of [['Postgres'], ['postgres', 'Apple'], ['  POSTGRES ']]) {
        ids.push(...(await store.getState().resolveCategoryIds(names, org.id)))
      }
      const postgres = await categoryRows('postgres')
      expect(postgres).toHaveLength(1)
      expect(ids.filter((id) => id === postgres[0].id)).toHaveLength(3)
      expect(store.getState().categoriesByOrg[org.id].map((c) => c.name)).toEqual(['Apple', 'Postgres', 'Zebra'])
    })

    it('a category another tab created (not in this store’s list) resolves to that row instead of a duplicate', async () => {
      const store = createTaxonomyStore(owner.client)
      await store.getState().loadCategories(org.id)
      const { data: other } = await editor.client
        .from('categories')
        .insert({ organization_id: org.id, name: 'Made Elsewhere' })
        .select('id')
        .single()
      const [id] = await store.getState().resolveCategoryIds(['Made Elsewhere'], org.id)
      expect(id).toBe(other.id)
      expect(await categoryRows('Made Elsewhere')).toHaveLength(1)
    })

    it('resolves tags the same way, and refuses before the author’s tags are loaded', async () => {
      const store = createTaxonomyStore(owner.client)
      await expect(store.getState().resolveTagIds(['react'])).rejects.toThrow()
      await store.getState().loadTags(owner.id)
      const first = await store.getState().resolveTagIds(['react', 'bash'])
      const again = await store.getState().resolveTagIds(['React'])
      expect(again[0]).toBe(first[0])
      const { data } = await adminClient.from('tags').select('id').eq('author_id', owner.id).ilike('name', 'react')
      expect(data).toHaveLength(1)
    })

    it('a tag made in another tab is reused rather than duplicated -- by both the resolver and the editor’s Save', async () => {
      const store = createTaxonomyStore(owner.client)
      await store.getState().loadTags(owner.id)
      // Written behind the store's back, as another tab would.
      const { data: elsewhere } = await owner.client
        .from('tags')
        .insert({ author_id: owner.id, name: 'Elsewhere' })
        .select('id')
        .single()
      const { data: again } = await owner.client
        .from('tags')
        .insert({ author_id: owner.id, name: 'Again' })
        .select('id')
        .single()

      expect(await store.getState().resolveTagIds(['elsewhere'])).toEqual([elsewhere.id])
      const { tag, error } = await store.getState().createTag('again')
      expect(error).toBeNull()
      expect(tag.id).toBe(again.id)

      for (const name of ['elsewhere', 'again']) {
        const { data } = await adminClient.from('tags').select('id').eq('author_id', owner.id).ilike('name', name)
        expect(data).toHaveLength(1)
      }
    })

    it('names with LIKE wildcards are matched literally', async () => {
      const store = createTaxonomyStore(owner.client)
      await store.getState().loadCategories(org.id)
      const [percent] = await store.getState().resolveCategoryIds(['100%'], org.id)
      const [other] = await store.getState().resolveCategoryIds(['1000'], org.id)
      expect(other).not.toBe(percent)
    })

    it('the editor’s add/delete category and create tag report errors instead of skipping', async () => {
      const store = createTaxonomyStore(owner.client)
      expect((await store.getState().createTag('too-early')).error).not.toBeNull()

      await Promise.all([store.getState().loadTags(owner.id), store.getState().loadCategories(org.id)])
      const added = await store.getState().addCategory(org.id, 'Brand New')
      expect(added.error).toBeNull()
      expect(store.getState().categoriesByOrg[org.id].some((c) => c.id === added.category.id)).toBe(true)

      const duplicate = await store.getState().addCategory(org.id, 'Brand New')
      expect(duplicate.error).not.toBeNull()

      expect((await store.getState().deleteCategory(org.id, added.category.id)).error).toBeNull()
      expect(store.getState().categoriesByOrg[org.id].some((c) => c.id === added.category.id)).toBe(false)
      expect(await categoryRows('Brand New')).toHaveLength(0)

      const tag = await store.getState().createTag('fresh-tag')
      expect(tag.error).toBeNull()
      expect(store.getState().tags.some((t) => t.name === 'fresh-tag')).toBe(true)
    })

    it('a blog with nothing loaded selects the same empty list every time, so it can’t re-render forever', () => {
      const store = createTaxonomyStore(owner.client)
      const select = (s) => s.categoriesByOrg['not-loaded'] || NO_CATEGORIES
      expect(select(store.getState())).toBe(select(store.getState()))
    })
  })

  describe('feature flags store', () => {
    const FLAG = 'ai_description_generation'
    let original

    beforeAll(async () => {
      const { data } = await adminClient.from('feature_flags').select('enabled').eq('key', FLAG).single()
      original = data.enabled
    })

    afterAll(() => adminClient.from('feature_flags').update({ enabled: original }).eq('key', FLAG))

    it('loads every flag, and only ever opens one Realtime channel however often it’s started', async () => {
      const client = createTestClient()
      const store = createFeatureFlagsStore(client)
      store.getState().start()
      store.getState().start()
      store.getState().start()
      await waitFor(() => store.getState().loaded)

      const { data: rows } = await adminClient.from('feature_flags').select('key, enabled')
      expect(store.getState().flags).toEqual(Object.fromEntries(rows.map((r) => [r.key, r.enabled])))
      expect(client.getChannels()).toHaveLength(1)
      await client.removeAllChannels()
    })


    it('setFlag updates the database and the store for a site admin, and is refused for anyone else', async () => {
      await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', editor.id)
      try {
        const store = createFeatureFlagsStore(editor.client)
        store.getState().start()
        await waitFor(() => store.getState().loaded)
        expect((await store.getState().setFlag(FLAG, !original)).error).toBeNull()
        expect(store.getState().flags[FLAG]).toBe(!original)
        const { data } = await adminClient.from('feature_flags').select('enabled').eq('key', FLAG).single()
        expect(data.enabled).toBe(!original)
        await editor.client.removeAllChannels()

        const notAdmin = createFeatureFlagsStore(owner.client)
        notAdmin.getState().start()
        await waitFor(() => notAdmin.getState().loaded)
        expect((await notAdmin.getState().setFlag(FLAG, original)).error).not.toBeNull()
        expect(notAdmin.getState().flags[FLAG]).toBe(!original)
        await owner.client.removeAllChannels()
      } finally {
        await adminClient.from('profiles').update({ is_site_admin: false }).eq('id', editor.id)
        await adminClient.from('feature_flags').update({ enabled: original }).eq('key', FLAG)
      }
    })

    it(
      'picks up a flag flipped on /admin while the page is open',
      async () => {
        const client = createTestClient()
        const store = createFeatureFlagsStore(client)
        store.getState().start()
        await waitFor(() => store.getState().loaded)
        // Give the Realtime subscription a moment to be confirmed.
        await waitFor(() => client.getChannels()[0]?.state === 'joined')

        await adminClient.from('feature_flags').update({ enabled: !original }).eq('key', FLAG)
        await waitFor(() => store.getState().flags[FLAG] === !original, 15_000)
        await client.removeAllChannels()
      },
      30_000,
    )
  })
})
