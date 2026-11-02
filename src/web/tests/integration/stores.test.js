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
