// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// The "Schedule & history" panel on /social: upcoming_social_runs
// (20261019120000) lists a scheduled LinkedIn post's next few times using
// the scheduler's own rules (author's time zone, daylight saving, month
// ends, end dates, which message variation each run uses), and
// social_post_runs holds its history. Far-future dates keep every time
// exact; times are checked as exact UTC moments.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function newAuthor(name) {
  const client = createTestClient()
  const { data, error } = await client.auth.signUp({
    email: emailFor(name),
    password: PASSWORD,
    options: { data: { username: `${name}-${runId}`, user_type: 'author', new_organization_name: `${name} Org ${runId}` } },
  })
  if (error) throw error
  createdUserIds.push(data.user.id)
  await confirmSignup(client, emailFor(name))
  const { data: membership } = await adminClient
    .from('memberships')
    .select('organization_id')
    .eq('user_id', data.user.id)
    .single()
  createdOrgIds.push(membership.organization_id)
  return { client, id: data.user.id }
}

const iso = (d) => new Date(d).toISOString()

describe('scheduled post timeline', () => {
  let owner
  let stranger

  // Creates a schedule as its author; `changes` then sets fields only the
  // scheduler itself writes (run_count, status).
  async function schedule(fields, changes = null) {
    const { data, error } = await owner.client
      .from('scheduled_social_posts')
      .insert({ messages: ['First wording'], timezone: 'America/New_York', recurrence: 'none', ...fields })
      .select('id')
      .single()
    if (error) throw error
    if (changes) await adminClient.from('scheduled_social_posts').update(changes).eq('id', data.id)
    return data.id
  }

  async function upcoming(id, client = owner.client, count = 5) {
    const { data, error } = await client.rpc('upcoming_social_runs', { p_schedule_id: id, p_count: count })
    expect(error).toBeNull()
    return data.map((r) => ({ at: iso(r.run_at), variation: r.variation }))
  }

  beforeAll(async () => {
    owner = await newAuthor('timeline-owner')
    stranger = await newAuthor('timeline-stranger')
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  it('lists the next five times of a daily post, keeping 9am local across the spring daylight-saving change', async () => {
    // Clocks go forward on March 10, 2030: 9am EST is 14:00 UTC, 9am EDT is 13:00 UTC.
    const id = await schedule({
      messages: ['One', 'Two', 'Three'],
      first_run_at: '2030-03-08T14:00:00Z',
      recurrence: 'daily',
    })
    expect(await upcoming(id)).toEqual([
      { at: '2030-03-08T14:00:00.000Z', variation: 1 },
      { at: '2030-03-09T14:00:00.000Z', variation: 2 },
      { at: '2030-03-10T13:00:00.000Z', variation: 3 },
      { at: '2030-03-11T13:00:00.000Z', variation: 1 },
      { at: '2030-03-12T13:00:00.000Z', variation: 2 },
    ])
  })

  it('carries on the variation rotation from how many times it has already run', async () => {
    const id = await schedule(
      { messages: ['One', 'Two', 'Three'], first_run_at: '2030-04-01T13:00:00Z', recurrence: 'weekly' },
      { run_count: 4 },
    )
    expect((await upcoming(id, owner.client, 3)).map((u) => u.variation)).toEqual([2, 3, 1])
  })

  it('keeps a monthly post on its original day, using the last day of shorter months', async () => {
    const id = await schedule({ first_run_at: '2031-01-31T15:00:00Z', recurrence: 'monthly' })
    expect((await upcoming(id, owner.client, 4)).map((u) => u.at)).toEqual([
      '2031-01-31T15:00:00.000Z',
      '2031-02-28T15:00:00.000Z',
      '2031-03-31T14:00:00.000Z', // after the daylight-saving change
      '2031-04-30T14:00:00.000Z',
    ])
  })

  it('stops at the end date, including an occurrence exactly on it', async () => {
    const id = await schedule({
      first_run_at: '2030-05-06T13:00:00Z',
      recurrence: 'weekly',
      ends_at: '2030-05-20T13:00:00Z',
    })
    expect((await upcoming(id)).map((u) => u.at)).toEqual([
      '2030-05-06T13:00:00.000Z',
      '2030-05-13T13:00:00.000Z',
      '2030-05-20T13:00:00.000Z',
    ])
  })

  it('a one-time post has exactly one upcoming time', async () => {
    const id = await schedule({ first_run_at: '2030-06-01T16:00:00Z' })
    expect(await upcoming(id)).toEqual([{ at: '2030-06-01T16:00:00.000Z', variation: 1 }])
  })

  it('a paused, finished or failed post has nothing coming up', async () => {
    for (const status of ['paused', 'completed', 'failed']) {
      const id = await schedule({ first_run_at: '2030-07-01T13:00:00Z', recurrence: 'daily' }, { status })
      expect(await upcoming(id), status).toEqual([])
    }
  })

  it('caps how many times it lists', async () => {
    const id = await schedule({ first_run_at: '2030-08-01T13:00:00Z', recurrence: 'daily' })
    expect(await upcoming(id, owner.client, 500)).toHaveLength(20)
  })

  it('history: the author sees their post’s runs; nobody else sees its times or history', async () => {
    const id = await schedule({ first_run_at: '2030-09-01T13:00:00Z', recurrence: 'daily' })
    await adminClient.from('social_post_runs').insert({
      schedule_id: id,
      user_id: owner.id,
      status: 'success',
      external_id: 'urn:li:share:123',
      message: 'First wording',
    })

    const { data: mine } = await owner.client.from('social_post_runs').select('status, external_id').eq('schedule_id', id)
    expect(mine).toEqual([{ status: 'success', external_id: 'urn:li:share:123' }])

    const { data: theirs } = await stranger.client.from('social_post_runs').select('id').eq('schedule_id', id)
    expect(theirs).toEqual([])
    expect(await upcoming(id, stranger.client)).toEqual([])
  })
})
