// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Additionally requires
// the invite-member Edge Function to be served, which `npx supabase
// start` does automatically once supabase/functions/invite-member
// exists (no separate `functions serve` process needed).
//
// Covers supabase/functions/invite-member/index.ts: only an org owner
// can invite, the invited email really ends up an editor of that
// specific org (via the *existing*, unmodified handle_new_user
// invite_code handling), and re-inviting an already-registered email
// is rejected with a distinct error instead of a generic failure.
import { FunctionsHttpError } from '@supabase/supabase-js'
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

async function invokeInvite(client, body) {
  const { data, error } = await client.functions.invoke('invite-member', { body })
  if (error instanceof FunctionsHttpError) {
    const errorBody = await error.context.json()
    return { ok: false, status: error.context.status, errorBody }
  }
  return { ok: true, data }
}

describe('invite-member Edge Function', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let ownerClient
  let ownerId
  let orgId
  let inviteCode

  beforeAll(async () => {
    ownerClient = createTestClient()
    const { user } = await signUp(ownerClient, emailFor('invite-fn-owner'), {
      username: 'invite-fn-owner-' + runId,
      user_type: 'author',
      new_organization_name: 'Invite Fn Org ' + runId,
    })
    ownerId = user.id

    const { data: membership } = await ownerClient
      .from('memberships')
      .select('organizations(id, invite_code)')
      .eq('user_id', ownerId)
      .single()
    orgId = membership.organizations.id
    inviteCode = membership.organizations.invite_code
    createdOrgIds.push(orgId)
  })

  it('rejects a caller who does not own an org', async () => {
    const readerClient = createTestClient()
    await signUp(readerClient, emailFor('invite-fn-reader'), {
      username: 'invite-fn-reader-' + runId,
      user_type: 'reader',
    })

    const result = await invokeInvite(readerClient, { email: emailFor('nobody-cares') })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.errorBody.error).toBe('not_an_org_owner')
  })

  it('rejects a malformed email', async () => {
    const result = await invokeInvite(ownerClient, { email: 'not-an-email' })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.errorBody.error).toBe('invalid_email')
  })

  it('an org owner can invite a new email, and they really end up an editor of that org', async () => {
    const inviteeEmail = emailFor('invite-fn-invitee')
    const result = await invokeInvite(ownerClient, { email: inviteeEmail })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ ok: true })

    const { data: invitee } = await adminClient.auth.admin.listUsers()
    const invitedUser = invitee.users.find((u) => u.email === inviteeEmail)
    expect(invitedUser).toBeTruthy()
    createdUserIds.push(invitedUser.id)
    expect(invitedUser.user_metadata.invite_code).toBe(inviteCode)

    const { data: membership } = await adminClient
      .from('memberships')
      .select('role, organization_id')
      .eq('user_id', invitedUser.id)
      .single()
    expect(membership).toMatchObject({ role: 'editor', organization_id: orgId })
  })

  it('rejects re-inviting an email that already has an account', async () => {
    const existingEmail = emailFor('invite-fn-reader')
    const result = await invokeInvite(ownerClient, { email: existingEmail })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.errorBody.error).toBe('already_registered')
  })
})
