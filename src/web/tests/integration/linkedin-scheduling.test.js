// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Covers
// 20260921100000_linkedin_scheduled_posts.sql (who can see/create/change
// what, the recurrence math, and the claim/complete worker lifecycle) and
// the gating on the linkedin-* Edge Functions.
//
// Deliberately NOT covered here: real LinkedIn calls (needs a live app
// and member token). The OAuth exchange, the Posts API payload, and the
// pg_cron -> processor path were verified by hand against a local mock of
// LinkedIn instead.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const FLAG = 'linkedin_posting'

const createdUserIds = []
const createdOrgIds = []

async function signUp(client, email, data) {
  const { data: result, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data } })
  if (error) throw error
  createdUserIds.push(result.user.id)
  return confirmSignup(client, email)
}

async function newAuthor(name) {
  const client = createTestClient()
  const { user } = await signUp(client, emailFor(name), {
    username: `${name}-${runId}`,
    user_type: 'author',
    new_organization_name: `${name} Org ${runId}`,
  })
  const { data: membership } = await client
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .single()
  createdOrgIds.push(membership.organization_id)
  return { client, id: user.id, orgId: membership.organization_id }
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

function setFlag(enabled) {
  return adminClient.from('feature_flags').update({ enabled }).eq('key', FLAG)
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error instanceof FunctionsHttpError) {
    return { ok: false, status: error.context.status, body: await error.context.json().catch(() => null) }
  }
  return { ok: true, status: 200, body: data }
}

describe('LinkedIn scheduled posts', () => {
  let owner
  let stranger
  let ownPostId
  let strangerPostId

  beforeAll(async () => {
    await setFlag(false)
    owner = await newAuthor('li-owner')
    stranger = await newAuthor('li-stranger')

    const post = (author, title) =>
      author.client
        .from('posts')
        .insert({
          organization_id: author.orgId,
          author_id: author.id,
          title,
          content: '<p>content</p>',
          status: 'published',
          published_at: new Date().toISOString(),
        })
        .select('id')
        .single()
    ownPostId = (await post(owner, 'Owner post ' + runId)).data.id
    strangerPostId = (await post(stranger, 'Stranger post ' + runId)).data.id
  })

  afterEach(async () => {
    await adminClient.from('scheduled_social_posts').delete().eq('user_id', owner.id)
  })

  afterAll(async () => {
    await setFlag(false)
    await cleanupTestData(createdOrgIds, createdUserIds)
  })

  // Inserts as the owner (the real client path) and returns the row id.
  async function schedule(overrides = {}) {
    const { data, error } = await owner.client
      .from('scheduled_social_posts')
      .insert({ messages: ['hello'], first_run_at: inAnHour(), timezone: 'UTC', recurrence: 'none', ...overrides })
      .select('id')
      .single()
    if (error) throw error
    return data.id
  }

  const row = async (id) =>
    (await adminClient.from('scheduled_social_posts').select('*').eq('id', id).single()).data

  // Makes a schedule due right now, as if its time had arrived.
  const makeDue = (id) =>
    adminClient
      .from('scheduled_social_posts')
      .update({ next_run_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', id)

  describe('who can see and change what', () => {
    it('never exposes the access token to a client, only the status', async () => {
      await adminClient.from('linkedin_connections').upsert({
        user_id: owner.id,
        member_urn: 'urn:li:person:test',
        member_name: 'Test Owner',
        access_token: 'super-secret-token',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      })

      const direct = await owner.client.from('linkedin_connections').select('access_token')
      expect(direct.error).not.toBeNull()

      const { data: status } = await owner.client.rpc('my_linkedin_connection')
      expect(status).toHaveLength(1)
      expect(status[0].member_name).toBe('Test Owner')
      expect(JSON.stringify(status)).not.toContain('super-secret-token')

      const { data: strangerStatus } = await stranger.client.rpc('my_linkedin_connection')
      expect(strangerStatus).toEqual([])

      const states = await owner.client.from('linkedin_oauth_states').select('state')
      expect(states.error).not.toBeNull()

      await owner.client.rpc('disconnect_linkedin')
      const { data: after } = await owner.client.rpc('my_linkedin_connection')
      expect(after).toEqual([])
    })

    it('a user sees only their own schedules', async () => {
      const id = await schedule()
      const { data: mine } = await owner.client.from('scheduled_social_posts').select('id').eq('id', id)
      expect(mine).toEqual([{ id }])
      const { data: theirs } = await stranger.client.from('scheduled_social_posts').select('id').eq('id', id)
      expect(theirs).toEqual([])
    })

    it("can link the author's own post but not someone else's", async () => {
      const ok = await owner.client
        .from('scheduled_social_posts')
        .insert({ post_id: ownPostId, messages: ['x'], first_run_at: inAnHour() })
      expect(ok.error).toBeNull()

      const bad = await owner.client
        .from('scheduled_social_posts')
        .insert({ post_id: strangerPostId, messages: ['x'], first_run_at: inAnHour() })
      expect(bad.error).not.toBeNull()
    })

    it('cannot set server-owned columns on insert, or update a schedule at all', async () => {
      const forged = await owner.client
        .from('scheduled_social_posts')
        .insert({ messages: ['x'], first_run_at: inAnHour(), run_count: 99 })
      expect(forged.error).not.toBeNull()

      const id = await schedule()
      const update = await owner.client.from('scheduled_social_posts').update({ status: 'completed' }).eq('id', id)
      expect(update.error).not.toBeNull()
      expect((await row(id)).status).toBe('scheduled')
    })

    it('cannot call the worker functions', async () => {
      const claim = await owner.client.rpc('claim_due_social_posts')
      expect(claim.error).not.toBeNull()
      const complete = await owner.client.rpc('complete_social_post_run', {
        p_id: crypto.randomUUID(),
        p_ok: true,
        p_external_id: null,
        p_error: null,
        p_message: 'x',
      })
      expect(complete.error).not.toBeNull()
      const secret = await owner.client.rpc('check_social_cron_secret', { p_secret: 'anything' })
      expect(secret.error).not.toBeNull()
    })

    it('rejects a wrong cron secret', async () => {
      const { data } = await adminClient.rpc('check_social_cron_secret', { p_secret: 'not-the-secret' })
      expect(data).toBe(false)
    })
  })

  describe('validation', () => {
    const insert = (overrides) =>
      owner.client.from('scheduled_social_posts').insert({ messages: ['ok'], first_run_at: inAnHour(), ...overrides })

    it('rejects an empty message and an over-long one', async () => {
      expect((await insert({ messages: ['   '] })).error).not.toBeNull()
      expect((await insert({ messages: ['x'.repeat(3001)] })).error).not.toBeNull()
      expect((await insert({ messages: [] })).error).not.toBeNull()
    })

    it('rejects an unknown timezone', async () => {
      expect((await insert({ timezone: 'Mars/Olympus_Mons' })).error).not.toBeNull()
    })

    it('rejects an end date before the first run', async () => {
      const first = new Date(Date.now() + 2 * 3600 * 1000).toISOString()
      const before = new Date(Date.now() + 3600 * 1000).toISOString()
      expect((await insert({ first_run_at: first, ends_at: before, recurrence: 'daily' })).error).not.toBeNull()
    })

    it('treats a start time in the past as "now" instead of an error', async () => {
      const id = await schedule({ first_run_at: new Date(Date.now() - 3600 * 1000).toISOString() })
      const r = await row(id)
      expect(new Date(r.first_run_at).getTime()).toBeGreaterThan(Date.now() - 60000)
    })

    it('caps a user at 20 active schedules', async () => {
      for (let i = 0; i < 20; i++) await schedule()
      const over = await insert({})
      expect(over.error?.message).toContain('too many active')
    })
  })

  describe('recurrence math', () => {
    const next = async (first, tz, rec, after) =>
      (await adminClient.rpc('social_next_run', { first_run: first, tz, rec, after_ts: after })).data

    it('does not repeat when recurrence is none', async () => {
      expect(await next('2026-09-21T10:00:00Z', 'UTC', 'none', '2026-09-21T10:00:01Z')).toBeNull()
    })

    it('keeps a daily 9:00 local post at 9:00 across the US DST change', async () => {
      // 9:00 EST (14:00Z) on Mar 7 2026; DST starts Mar 8, so 9:00 is then 13:00Z.
      const result = await next('2026-03-07T14:00:00Z', 'America/New_York', 'daily', '2026-03-07T14:00:01Z')
      expect(new Date(result).toISOString()).toBe('2026-03-08T13:00:00.000Z')
    })

    it('advances weekly by exactly seven days', async () => {
      const result = await next('2026-09-21T10:00:00Z', 'UTC', 'weekly', '2026-09-21T10:00:01Z')
      expect(new Date(result).toISOString()).toBe('2026-09-28T10:00:00.000Z')
    })

    it('anchors monthly to the original day, so Jan 31 is Feb 28 and then Mar 31 (not Mar 28)', async () => {
      const feb = await next('2026-01-31T12:00:00Z', 'UTC', 'monthly', '2026-01-31T12:00:01Z')
      expect(new Date(feb).toISOString()).toBe('2026-02-28T12:00:00.000Z')
      const mar = await next('2026-01-31T12:00:00Z', 'UTC', 'monthly', '2026-02-28T12:00:01Z')
      expect(new Date(mar).toISOString()).toBe('2026-03-31T12:00:00.000Z')
    })
  })

  describe('worker lifecycle', () => {
    const complete = (id, { ok = true, error = null, fatal = false } = {}) =>
      adminClient.rpc('complete_social_post_run', {
        p_id: id,
        p_ok: ok,
        p_external_id: ok ? 'urn:li:share:1' : null,
        p_error: error,
        p_message: 'hello',
        p_fatal: fatal,
      })

    it('hands a due schedule to exactly one worker at a time', async () => {
      const id = await schedule()
      await makeDue(id)

      const first = await adminClient.rpc('claim_due_social_posts')
      expect(first.data.map((r) => r.id)).toContain(id)
      const second = await adminClient.rpc('claim_due_social_posts')
      expect(second.data.map((r) => r.id)).not.toContain(id)
    })

    it('does not claim a schedule that is not due yet', async () => {
      const id = await schedule()
      const { data } = await adminClient.rpc('claim_due_social_posts')
      expect(data.map((r) => r.id)).not.toContain(id)
    })

    it('reclaims a schedule whose worker died (stale lock)', async () => {
      const id = await schedule()
      await adminClient
        .from('scheduled_social_posts')
        .update({
          next_run_at: new Date(Date.now() - 1000).toISOString(),
          locked_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
        })
        .eq('id', id)
      const { data } = await adminClient.rpc('claim_due_social_posts')
      expect(data.map((r) => r.id)).toContain(id)
    })

    it('completes a one-time schedule and records the run', async () => {
      const id = await schedule()
      await complete(id)
      const r = await row(id)
      expect(r).toMatchObject({ status: 'completed', run_count: 1, next_run_at: null, last_error: null })

      const { data: runs } = await adminClient.from('social_post_runs').select('status, external_id').eq('schedule_id', id)
      expect(runs).toEqual([{ status: 'success', external_id: 'urn:li:share:1' }])
    })

    it('moves a repeating schedule on to its next occurrence', async () => {
      const id = await schedule({ recurrence: 'daily' })
      await complete(id)
      const r = await row(id)
      expect(r.status).toBe('scheduled')
      expect(r.run_count).toBe(1)
      expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now())
    })

    it('skips occurrences missed while the app was down instead of posting a backlog', async () => {
      const id = await schedule({ recurrence: 'daily' })
      const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
      await adminClient.from('scheduled_social_posts').update({ first_run_at: tenDaysAgo, next_run_at: tenDaysAgo }).eq('id', id)
      await complete(id)
      const nextAt = new Date((await row(id)).next_run_at).getTime()
      expect(nextAt).toBeGreaterThan(Date.now())
      expect(nextAt).toBeLessThan(Date.now() + 25 * 3600 * 1000)
    })

    it('completes a repeating schedule once its end date has passed', async () => {
      const first = new Date(Date.now() + 60 * 1000)
      const id = await schedule({
        recurrence: 'daily',
        first_run_at: first.toISOString(),
        ends_at: new Date(first.getTime() + 3600 * 1000).toISOString(),
      })
      await complete(id)
      expect(await row(id)).toMatchObject({ status: 'completed', next_run_at: null })
    })

    it('keeps a repeating schedule going after an ordinary failure, but records it', async () => {
      const id = await schedule({ recurrence: 'daily' })
      await complete(id, { ok: false, error: 'linkedin_500: boom' })
      const r = await row(id)
      expect(r.status).toBe('scheduled')
      expect(r.last_error).toBe('linkedin_500: boom')
    })

    it('fails a one-time schedule on any failure', async () => {
      const id = await schedule()
      await complete(id, { ok: false, error: 'linkedin_500: boom' })
      expect(await row(id)).toMatchObject({ status: 'failed', next_run_at: null })
    })

    it('stops a repeating schedule for good on a fatal error', async () => {
      const id = await schedule({ recurrence: 'daily' })
      await complete(id, { ok: false, error: 'token_expired', fatal: true })
      expect(await row(id)).toMatchObject({ status: 'failed', next_run_at: null, last_error: 'token_expired' })
    })
  })

  describe('pause and resume', () => {
    it('a paused schedule is not picked up, and resuming skips what was missed', async () => {
      const id = await schedule({ recurrence: 'daily' })
      expect((await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: true })).error).toBeNull()
      expect((await row(id)).status).toBe('paused')

      await adminClient
        .from('scheduled_social_posts')
        .update({ next_run_at: new Date(Date.now() - 3 * 86400000).toISOString() })
        .eq('id', id)
      const { data: claimed } = await adminClient.rpc('claim_due_social_posts')
      expect(claimed.map((r) => r.id)).not.toContain(id)

      await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: false })
      const r = await row(id)
      expect(r.status).toBe('scheduled')
      expect(new Date(r.next_run_at).getTime()).toBeGreaterThan(Date.now())
    })

    it('lets a failed schedule be retried, and refuses someone else pausing it', async () => {
      const id = await schedule()
      await adminClient.rpc('complete_social_post_run', {
        p_id: id, p_ok: false, p_external_id: null, p_error: 'boom', p_message: 'x', p_fatal: true,
      })
      expect((await row(id)).status).toBe('failed')

      const intruder = await stranger.client.rpc('set_social_post_paused', { p_id: id, p_paused: false })
      expect(intruder.error).not.toBeNull()
      expect((await row(id)).status).toBe('failed')

      await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: false })
      expect(await row(id)).toMatchObject({ status: 'scheduled', last_error: null })
    })
  })

  describe('Edge Functions', () => {
    it('are refused while the feature flag is off', async () => {
      const start = await invoke(owner.client, 'linkedin-connect-start', {})
      expect(start).toMatchObject({ ok: false, status: 403, body: { error: 'feature_disabled' } })

      const id = await schedule()
      const now = await invoke(owner.client, 'linkedin-post-now', { scheduleId: id })
      expect(now).toMatchObject({ ok: false, status: 403, body: { error: 'feature_disabled' } })
      expect((await row(id)).status).toBe('scheduled')
    })

    it('require a signed-in user', async () => {
      const anon = createTestClient()
      expect((await invoke(anon, 'linkedin-connect-start', {})).status).toBe(401)
      expect((await invoke(anon, 'linkedin-post-now', { scheduleId: crypto.randomUUID() })).status).toBe(401)
    })

    it('keep the processor closed to anyone without the cron secret', async () => {
      const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/linkedin-process-due`, {
        method: 'POST',
        headers: { Authorization: 'Bearer definitely-not-the-secret' },
      })
      expect(res.status).toBe(401)
    })

    it('sends a bad OAuth callback back to the app as an error, with no login required', async () => {
      // verify_jwt is off for this function (it's a bare browser redirect),
      // so this also proves that setting is honoured -- a gateway 401
      // would come back instead of a redirect.
      const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/linkedin-oauth-callback?code=x&state=forged`, {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toContain('/social?linkedin=error')
    })

    it('passes LinkedIn\'s own refusal reason back to the page instead of hiding it', async () => {
      // e.g. the app's "Share on LinkedIn" product isn't approved yet.
      const res = await fetch(
        `${process.env.SUPABASE_URL}/functions/v1/linkedin-oauth-callback?error=unauthorized_scope_error&error_description=x`,
        { redirect: 'manual' },
      )
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location'))
      expect(location.searchParams.get('linkedin')).toBe('error')
      expect(location.searchParams.get('reason')).toBe('unauthorized_scope_error')

      // Anything that isn't a plain code is not echoed into the URL.
      const odd = await fetch(
        `${process.env.SUPABASE_URL}/functions/v1/linkedin-oauth-callback?error=%3Cscript%3E`,
        { redirect: 'manual' },
      )
      expect(new URL(odd.headers.get('location')).searchParams.get('reason')).toBe('linkedin_error')
    })

    describe('with the feature flag on', () => {
      beforeAll(() => setFlag(true))
      afterAll(() => setFlag(false))

      it('"Post now" fails a schedule cleanly when LinkedIn is not connected', async () => {
        const id = await schedule()
        const result = await invoke(owner.client, 'linkedin-post-now', { scheduleId: id })
        expect(result.body).toEqual({ ok: false, error: 'not_connected' })
        expect(await row(id)).toMatchObject({ status: 'failed', last_error: 'not_connected', run_count: 1 })
      })

      it('will not run a schedule that belongs to someone else, or one that does not exist', async () => {
        const id = await schedule()
        const theirs = await invoke(stranger.client, 'linkedin-post-now', { scheduleId: id })
        expect(theirs).toMatchObject({ ok: false, status: 404 })
        expect((await row(id)).run_count).toBe(0)

        const missing = await invoke(owner.client, 'linkedin-post-now', { scheduleId: crypto.randomUUID() })
        expect(missing).toMatchObject({ ok: false, status: 404 })
      })

      it('will not run a paused schedule', async () => {
        const id = await schedule()
        await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: true })
        const result = await invoke(owner.client, 'linkedin-post-now', { scheduleId: id })
        expect(result).toMatchObject({ ok: false, status: 409, body: { error: 'not_runnable' } })
      })
    })
  })
})
