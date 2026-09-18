// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Covers
// 20260918110000_create_suggestions.sql's RLS shape: any logged-in user
// can submit their own suggestion and see only their own, a site admin
// can see and update the status of every suggestion, and a plain user
// cannot see or update anyone else's. Doesn't exercise the
// submit-suggestion / update-suggestion-status Edge Functions'
// email-sending side (no RESEND_API_KEY in this test env, and both
// functions are written to swallow a failed/missing-key email rather
// than fail the request -- see supabase/functions/_shared/email.ts) --
// this only checks the RLS-protected table writes those functions rely
// on to work at all.
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

describe('suggestions', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let userClient
  let userId
  let strangerClient
  let strangerId
  let siteAdminClient
  let siteAdminId
  let suggestionId

  beforeAll(async () => {
    userClient = createTestClient()
    const { user } = await signUp(userClient, emailFor('sugg-user'), {
      username: 'sugg-user-' + runId,
      user_type: 'reader',
    })
    userId = user.id

    strangerClient = createTestClient()
    const { user: stranger } = await signUp(strangerClient, emailFor('sugg-stranger'), {
      username: 'sugg-stranger-' + runId,
      user_type: 'reader',
    })
    strangerId = stranger.id

    siteAdminClient = createTestClient()
    const { user: siteAdmin } = await signUp(siteAdminClient, emailFor('sugg-admin'), {
      username: 'sugg-admin-' + runId,
      user_type: 'reader',
    })
    siteAdminId = siteAdmin.id
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdminId)
  })

  it('a user can submit their own suggestion', async () => {
    const { data, error } = await userClient
      .from('suggestions')
      .insert({ user_id: userId, content: 'Add dark mode' })
      .select('id, status')
      .single()
    expect(error).toBeNull()
    expect(data.status).toBe('new')
    suggestionId = data.id
  })

  it('cannot submit a suggestion on behalf of someone else', async () => {
    const { error } = await userClient.from('suggestions').insert({ user_id: strangerId, content: 'Not mine' })
    expect(error).not.toBeNull()
  })

  it('a user sees only their own suggestions, not a stranger\'s', async () => {
    const { data: ownData } = await userClient.from('suggestions').select('id').eq('id', suggestionId)
    expect(ownData).toEqual([{ id: suggestionId }])

    const { data: strangerView } = await strangerClient.from('suggestions').select('id').eq('id', suggestionId)
    expect(strangerView).toEqual([])
  })

  it('a stranger cannot update the status of a suggestion that is not theirs', async () => {
    const { error, count } = await strangerClient
      .from('suggestions')
      .update({ status: 'planned' }, { count: 'exact' })
      .eq('id', suggestionId)
    // Same "RLS error or a silent zero-row update" shape as every other
    // using()-only policy in this codebase (see categories-and-tags.test.js).
    if (!error) {
      expect(count).toBe(0)
    }

    const { data } = await adminClient.from('suggestions').select('status').eq('id', suggestionId).single()
    expect(data.status).toBe('new')
  })

  it('a site admin can see every suggestion and update its status', async () => {
    const { data: allSeen } = await siteAdminClient.from('suggestions').select('id').eq('id', suggestionId)
    expect(allSeen).toEqual([{ id: suggestionId }])

    const { error } = await siteAdminClient.from('suggestions').update({ status: 'planned' }).eq('id', suggestionId)
    expect(error).toBeNull()

    const { data } = await adminClient.from('suggestions').select('status').eq('id', suggestionId).single()
    expect(data.status).toBe('planned')
  })
})
