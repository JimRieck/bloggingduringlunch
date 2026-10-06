// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Two-factor authentication is required for every account
// (20261006100000_require_mfa.sql). The app's setup/code screens are
// just the user-facing half; these tests pin down the half that makes
// it real security -- that a password-only ("aal1") session gets
// nothing from the database, storage or Edge Functions even when it
// skips the app entirely -- plus the site-admin reset for a lost phone.
// Codes are computed from the enrollment secret the same way a phone's
// authenticator app does (tests/helpers/totp.js).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminClient, cleanupTestData, confirmSignup, createTestClient, signInWithMfa } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function newAuthor(name, options) {
  const client = createTestClient()
  const { data, error } = await client.auth.signUp({
    email: emailFor(name),
    password: PASSWORD,
    options: { data: { username: `${name}-${runId}`, user_type: 'author', new_organization_name: `${name} Org ${runId}` } },
  })
  if (error) throw error
  createdUserIds.push(data.user.id)
  await confirmSignup(client, emailFor(name), options)
  const { data: membership } = await adminClient
    .from('memberships')
    .select('organization_id')
    .eq('user_id', data.user.id)
    .single()
  createdOrgIds.push(membership.organization_id)
  return { client, id: data.user.id, orgId: membership.organization_id }
}

async function passwordOnly(email) {
  const client = createTestClient()
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (error) throw error
  return client
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error instanceof FunctionsHttpError) {
    return { status: error.context.status, body: await error.context.json().catch(() => null) }
  }
  return { status: 200, body: data }
}

async function aal(client) {
  const { data } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
  return data
}

describe('required two-factor authentication', () => {
  let author
  let newcomer
  let siteAdmin
  let publishedPostId

  beforeAll(async () => {
    author = await newAuthor('mfa-author')
    newcomer = await newAuthor('mfa-newcomer', { mfa: false })
    siteAdmin = await newAuthor('mfa-admin')
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)

    const { data: post, error } = await author.client
      .from('posts')
      .insert({
        organization_id: author.orgId,
        author_id: author.id,
        title: 'MFA test post ' + runId,
        content: '<p>Readable by anyone</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error) throw error
    publishedPostId = post.id
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('a password-only session (no authenticator set up yet)', () => {
    it('is told to set one up: next level is still aal1', async () => {
      expect(await aal(newcomer.client)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal1' })
    })

    it('is refused by the database for tables, views and RPCs alike, with a clear reason', async () => {
      const table = await newcomer.client.from('profiles').select('id')
      expect(table.status).toBe(403)
      expect(table.error.message).toBe('mfa_required')

      const view = await newcomer.client.from('organizations_public').select('id')
      expect(view.status).toBe(403)

      const rpc = await newcomer.client.rpc('is_site_admin')
      expect(rpc.error.message).toBe('mfa_required')
    })

    it("can't write either, not even to its own data", async () => {
      const { error } = await newcomer.client
        .from('posts')
        .insert({ organization_id: newcomer.orgId, author_id: newcomer.id, title: 'x', content: '<p>x</p>' })
      expect(error.message).toBe('mfa_required')
    })

    it("can't upload files", async () => {
      const { error } = await newcomer.client.storage
        .from('avatars')
        .upload(`${newcomer.id}/mfa-test.png`, new Blob(['x'], { type: 'image/png' }))
      expect(error).not.toBeNull()
    })

    it('is treated as not logged in by Edge Functions', async () => {
      const result = await invoke(newcomer.client, 'submit-suggestion', { content: 'hello' })
      expect(result.status).toBe(401)
    })

    it('gets full access once it adds an authenticator and enters a code', async () => {
      const client = createTestClient()
      await client.auth.signInWithPassword({ email: emailFor('mfa-newcomer'), password: PASSWORD })
      const { data: factor } = await client.auth.mfa.enroll({ factorType: 'totp' })
      const { totp } = await import('../helpers/totp.js')
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(factor.totp.secret) })
      expect(error).toBeNull()
      expect((await aal(client)).currentLevel).toBe('aal2')

      const { data, error: selectError } = await client.from('profiles').select('id').eq('id', newcomer.id)
      expect(selectError).toBeNull()
      expect(data).toHaveLength(1)
    })
  })

  describe('an account that has an authenticator', () => {
    it('logging in with only the password is not enough', async () => {
      const client = await passwordOnly(emailFor('mfa-author'))
      expect(await aal(client)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal2' })
      const { error } = await client.from('posts').select('id').eq('id', publishedPostId)
      expect(error.message).toBe('mfa_required')
    })

    it('a wrong code is rejected and the session stays password-only', async () => {
      const client = await passwordOnly(emailFor('mfa-author'))
      const { data: factors } = await client.auth.mfa.listFactors()
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factors.totp[0].id, code: '000000' })
      expect(error).not.toBeNull()
      expect((await aal(client)).currentLevel).toBe('aal1')
    })

    it('password + current code gives full access', async () => {
      const client = createTestClient()
      await signInWithMfa(client, emailFor('mfa-author'), PASSWORD)
      const { data, error } = await client.from('posts').select('id').eq('id', publishedPostId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    })

    it("can't change its password until the code is entered (why the app asks for the code before a password reset)", async () => {
      const client = await passwordOnly(emailFor('mfa-author'))
      const { error } = await client.auth.updateUser({ password: 'a-different-password' })
      expect(error?.code).toBe('insufficient_aal')
    })
  })

  it('logged-out visitors can still read the public blog', async () => {
    const { data, error } = await createTestClient().from('posts').select('id').eq('id', publishedPostId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  describe('site admin reset (lost phone)', () => {
    it('a non-admin is refused', async () => {
      const result = await invoke(author.client, 'admin-reset-mfa', { userId: siteAdmin.id })
      expect(result.status).toBe(403)
    })

    it('an admin who has only entered their password is refused', async () => {
      const client = await passwordOnly(emailFor('mfa-admin'))
      const result = await invoke(client, 'admin-reset-mfa', { userId: author.id })
      expect(result.status).toBe(401)
    })

    it("an admin can't reset their own", async () => {
      const result = await invoke(siteAdmin.client, 'admin-reset-mfa', { userId: siteAdmin.id })
      expect(result.status).toBe(403)
    })

    it("removes the user's authenticator, so their next login goes back to setup", async () => {
      const result = await invoke(siteAdmin.client, 'admin-reset-mfa', { userId: author.id })
      expect(result).toMatchObject({ status: 200, body: { ok: true, removed: 1 } })

      const { data } = await adminClient.auth.admin.mfa.listFactors({ userId: author.id })
      expect(data.factors).toEqual([])

      const client = await passwordOnly(emailFor('mfa-author'))
      expect(await aal(client)).toMatchObject({ currentLevel: 'aal1', nextLevel: 'aal1' })
    })
  })
})
