// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261124100000_site_visits.sql: home page visits recorded
// through record_site_visit (what api/visit.js calls with the public
// key), readable only by site admins, and the admin page's two RPCs --
// hits per day and the visit list -- splitting days at Eastern
// midnight, not UTC.
//
// Every row this run writes uses its own path, so counts are exact
// regardless of other suites or earlier runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const PATH = `/test-visits-${runId}`
const SEEDED_PATH = `${PATH}-seeded`

const createdUserIds = []
const createdOrgIds = []

async function newUser(name, data) {
  const client = createTestClient()
  const { data: result, error } = await client.auth.signUp({
    email: emailFor(name),
    password: PASSWORD,
    options: { data: { username: `${name}-${runId}`, ...data } },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  await confirmSignup(client, emailFor(name))
  return { client, id: result.user.id }
}

const record = (client, overrides = {}) =>
  client.rpc('record_site_visit', {
    p_path: PATH,
    p_referrer: 'https://www.linkedin.com/feed/',
    p_utm_source: null,
    p_country: 'US',
    p_region: 'VA',
    p_city: 'Richmond',
    ...overrides,
  })

describe('home page visits', () => {
  let siteAdmin
  let stranger
  const anon = createTestClient()

  beforeAll(async () => {
    siteAdmin = await newUser('visits-admin', { user_type: 'author', new_organization_name: `Visits Org ${runId}` })
    const { data: membership } = await adminClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', siteAdmin.id)
      .single()
    createdOrgIds.push(membership.organization_id)
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)

    stranger = await newUser('visits-stranger', { user_type: 'reader' })

    // Either side of Eastern midnight, in winter (EST, UTC-5) and summer
    // (EDT, UTC-4).
    const { error } = await adminClient.from('site_visits').insert([
      { path: SEEDED_PATH, visited_at: '2025-01-15T04:59:00Z', city: 'Jan 14, 11:59pm' },
      { path: SEEDED_PATH, visited_at: '2025-01-15T05:00:00Z', city: 'Jan 15, midnight' },
      { path: SEEDED_PATH, visited_at: '2025-01-16T04:30:00Z', city: 'Jan 15, 11:30pm' },
      { path: SEEDED_PATH, visited_at: '2025-01-16T05:00:00Z', city: 'Jan 16, midnight' },
      { path: SEEDED_PATH, visited_at: '2025-07-10T03:59:00Z', city: 'Jul 9, 11:59pm' },
      { path: SEEDED_PATH, visited_at: '2025-07-10T04:00:00Z', city: 'Jul 10, midnight' },
    ])
    if (error) throw error
  })

  afterAll(async () => {
    await adminClient.from('site_visits').delete().like('path', `${PATH}%`)
    await cleanupTestData(createdOrgIds, createdUserIds)
  })

  describe('recording', () => {
    it('a signed-out visitor’s visit is recorded (the server function’s call, with the public key)', async () => {
      const { error } = await record(anon)
      expect(error).toBeNull()
      const { data } = await adminClient
        .from('site_visits')
        .select('path, referrer, utm_source, country, region, city, visited_at')
        .eq('path', PATH)
      expect(data).toHaveLength(1)
      expect(data[0]).toMatchObject({
        path: PATH,
        referrer: 'https://www.linkedin.com/feed/',
        utm_source: null,
        country: 'US',
        region: 'VA',
        city: 'Richmond',
      })
      expect(Date.now() - new Date(data[0].visited_at).getTime()).toBeLessThan(60_000)
    })

    it('tidies values (blank to null, codes upper-cased, too long trimmed) rather than losing the visit', async () => {
      const path = `${PATH}-tidy`
      const { error } = await record(anon, {
        p_path: path,
        p_referrer: '  ',
        p_utm_source: 'x'.repeat(150),
        p_country: 'gb',
        p_region: null,
        p_city: '',
      })
      expect(error).toBeNull()
      const { data } = await adminClient.from('site_visits').select('referrer, utm_source, country, city').eq('path', path)
      expect(data).toEqual([{ referrer: null, utm_source: 'x'.repeat(100), country: 'GB', city: null }])
    })

    it('records nothing for something that isn’t a page path', async () => {
      const { error } = await record(anon, { p_path: `https://example.com${PATH}` })
      expect(error).toBeNull()
      const { data } = await adminClient.from('site_visits').select('id').eq('path', `https://example.com${PATH}`)
      expect(data).toEqual([])
    })

    it('nobody can write the table directly', async () => {
      const { error: anonWrite } = await anon.from('site_visits').insert({ path: `${PATH}-direct` })
      expect(anonWrite).not.toBeNull()
      const { error: adminWrite } = await siteAdmin.client.from('site_visits').insert({ path: `${PATH}-direct` })
      expect(adminWrite).not.toBeNull()
    })
  })

  describe('reading', () => {
    it('only site admins can read visits', async () => {
      const { data: adminRows, error } = await siteAdmin.client.from('site_visits').select('path').eq('path', PATH)
      expect(error).toBeNull()
      expect(adminRows).toHaveLength(1)

      const { data: anonRows } = await anon.from('site_visits').select('id').eq('path', PATH)
      expect(anonRows ?? []).toEqual([])
      const { data: strangerRows } = await stranger.client.from('site_visits').select('id').eq('path', PATH)
      expect(strangerRows).toEqual([])
    })

    it('the admin RPCs give anyone else nothing, and aren’t open to signed-out callers at all', async () => {
      const args = { start_date: '2025-01-14', end_date: '2025-01-16', path_filter: SEEDED_PATH }
      const { data: strangerDays } = await stranger.client.rpc('site_visits_by_day', args)
      expect(strangerDays.map((d) => d.visits)).toEqual([0, 0, 0])
      const { data: strangerList } = await stranger.client.rpc('site_visit_list', args)
      expect(strangerList).toEqual([])

      const { error: anonDays } = await anon.rpc('site_visits_by_day', args)
      expect(anonDays).not.toBeNull()
      const { error: anonList } = await anon.rpc('site_visit_list', args)
      expect(anonList).not.toBeNull()
    })
  })

  describe('Eastern-time day boundaries', () => {
    it('hits per day split at Eastern midnight in winter (EST)', async () => {
      const { data, error } = await siteAdmin.client.rpc('site_visits_by_day', {
        start_date: '2025-01-14',
        end_date: '2025-01-16',
        path_filter: SEEDED_PATH,
      })
      expect(error).toBeNull()
      // Split at UTC midnight this would be 0, 2, 2.
      expect(data).toEqual([
        { day: '2025-01-14', visits: 1 },
        { day: '2025-01-15', visits: 2 },
        { day: '2025-01-16', visits: 1 },
      ])
    })

    it('hits per day split at Eastern midnight in summer (EDT)', async () => {
      const { data } = await siteAdmin.client.rpc('site_visits_by_day', {
        start_date: '2025-07-09',
        end_date: '2025-07-10',
        path_filter: SEEDED_PATH,
      })
      expect(data).toEqual([
        { day: '2025-07-09', visits: 1 },
        { day: '2025-07-10', visits: 1 },
      ])
    })

    it('the visit list covers exactly the Eastern days asked for, newest first', async () => {
      const { data, error } = await siteAdmin.client.rpc('site_visit_list', {
        start_date: '2025-01-15',
        end_date: '2025-01-15',
        path_filter: SEEDED_PATH,
      })
      expect(error).toBeNull()
      expect(data.map((v) => v.city)).toEqual(['Jan 15, 11:30pm', 'Jan 15, midnight'])

      const { data: summer } = await siteAdmin.client.rpc('site_visit_list', {
        start_date: '2025-07-10',
        end_date: '2025-07-10',
        path_filter: SEEDED_PATH,
      })
      expect(summer.map((v) => v.city)).toEqual(['Jul 10, midnight'])
    })

    it('the visit list is capped at max_rows, and gives each visit’s referring website', async () => {
      const { data } = await siteAdmin.client.rpc('site_visit_list', {
        start_date: '2025-01-14',
        end_date: '2025-07-10',
        path_filter: SEEDED_PATH,
        max_rows: 2,
      })
      expect(data.map((v) => v.city)).toEqual(['Jul 10, midnight', 'Jul 9, 11:59pm'])

      const today = await siteAdmin.client.rpc('site_visit_list', {
        start_date: '2025-01-01',
        end_date: '2099-12-31',
        path_filter: PATH,
      })
      expect(today.data[0]).toMatchObject({ referrer_host: 'www.linkedin.com', country: 'US' })
    })
  })
})
