// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261008100000_traffic_sources.sql: a view's utm_source tag,
// the site_traffic_sources RPC (views grouped by referring website and
// tag; named sources are worked out in the browser and unit-tested in
// tests/lib/trafficSources.test.js), and bot visits -- recorded only
// through record_bot_visit, readable only by site admins.
//
// Reader views are backdated to a fixed, far-past day so the counts are
// exact regardless of other suites; bot rows use a bot name unique to
// this run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const DAY = '2025-05-01'
const TODAY = new Date().toISOString().slice(0, 10)
const BOT = `TestBot-${runId}`

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

describe('traffic sources', () => {
  let author
  let siteAdmin
  let stranger
  let orgSlug
  let post
  let draft
  const anon = createTestClient()

  beforeAll(async () => {
    author = await newUser('traffic-author', { user_type: 'author', new_organization_name: `Traffic Org ${runId}` })
    const { data: membership } = await adminClient
      .from('memberships')
      .select('organization_id, organizations(slug)')
      .eq('user_id', author.id)
      .single()
    createdOrgIds.push(membership.organization_id)
    orgSlug = membership.organizations.slug

    const insertPost = (title, status) =>
      author.client
        .from('posts')
        .insert({
          organization_id: membership.organization_id,
          author_id: author.id,
          title,
          content: '<p>x</p>',
          status,
          published_at: status === 'published' ? new Date().toISOString() : null,
        })
        .select('id, slug')
        .single()
    ;({ data: post } = await insertPost(`Traffic post ${runId}`, 'published'))
    ;({ data: draft } = await insertPost(`Traffic draft ${runId}`, 'draft'))

    siteAdmin = await newUser('traffic-admin', { user_type: 'author', new_organization_name: `Traffic Admin Org ${runId}` })
    const { data: adminMembership } = await adminClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', siteAdmin.id)
      .single()
    createdOrgIds.push(adminMembership.organization_id)
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)

    stranger = await newUser('traffic-stranger', { user_type: 'reader' })

    const at = (hour) => `${DAY}T${String(hour).padStart(2, '0')}:00:00Z`
    const { error } = await adminClient.from('post_views').insert([
      { post_id: post.id, referrer: 'https://www.linkedin.com/feed/', viewed_at: at(9) },
      { post_id: post.id, referrer: 'https://www.linkedin.com/', viewed_at: at(10) },
      { post_id: post.id, referrer: 'https://www.google.com/search?q=lunch', viewed_at: at(11) },
      { post_id: post.id, referrer: null, utm_source: 'LinkedIn ', viewed_at: at(12) },
      { post_id: post.id, referrer: null, viewed_at: at(13) },
    ])
    if (error) throw error
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('reader views', () => {
    it('a logged-out reader’s view records the link’s utm_source tag', async () => {
      const { error } = await anon
        .from('post_views')
        .insert({ post_id: post.id, referrer: null, utm_source: 'linkedin' })
      expect(error).toBeNull()
      const { data } = await adminClient
        .from('post_views')
        .select('utm_source')
        .eq('post_id', post.id)
        .gte('viewed_at', `${TODAY}T00:00:00Z`)
      expect(data.map((r) => r.utm_source)).toContain('linkedin')
    })

    it('rejects an absurdly long tag', async () => {
      const { error } = await anon.from('post_views').insert({ post_id: post.id, utm_source: 'x'.repeat(101) })
      expect(error).not.toBeNull()
    })

    it('site_traffic_sources groups views by referring website (domain only) and tag, busiest first', async () => {
      const { data, error } = await siteAdmin.client.rpc('site_traffic_sources', { start_date: DAY, end_date: DAY })
      expect(error).toBeNull()
      expect(data[0]).toEqual({ referrer_host: 'www.linkedin.com', utm_source: null, views: 2 })
      expect(data).toEqual(
        expect.arrayContaining([
          { referrer_host: 'www.google.com', utm_source: null, views: 1 },
          { referrer_host: null, utm_source: 'linkedin', views: 1 },
          { referrer_host: null, utm_source: null, views: 1 },
        ]),
      )
      expect(data.reduce((sum, r) => sum + r.views, 0)).toBe(5)
    })

    it('someone outside the org who isn’t a site admin sees none of it', async () => {
      const { data } = await stranger.client.rpc('site_traffic_sources', { start_date: DAY, end_date: DAY })
      expect(data).toEqual([])
    })
  })

  describe('bot visits', () => {
    const record = (client, overrides = {}) =>
      client.rpc('record_bot_visit', {
        p_org_slug: orgSlug,
        p_post_slug: post.slug,
        p_bot_name: BOT,
        p_bot_category: 'ai',
        p_user_agent: `Mozilla/5.0 (compatible; ${BOT}/1.0)`,
        ...overrides,
      })

    it('the server function’s call (with the public key) records a visit to a published post', async () => {
      const { error } = await record(anon)
      expect(error).toBeNull()
      const { data } = await adminClient.from('bot_visits').select('post_id, bot_category').eq('bot_name', BOT)
      expect(data).toEqual([{ post_id: post.id, bot_category: 'ai' }])
    })

    it('records nothing for a draft, an unknown post, or an unknown category', async () => {
      await record(anon, { p_post_slug: draft.slug, p_bot_name: `${BOT}-draft` })
      await record(anon, { p_post_slug: 'no-such-post', p_bot_name: `${BOT}-missing` })
      await record(anon, { p_bot_category: 'made-up', p_bot_name: `${BOT}-category` })
      const { data } = await adminClient.from('bot_visits').select('bot_name').like('bot_name', `${BOT}-%`)
      expect(data).toEqual([])
    })

    it('can’t be read or written directly by anyone but site admins reading', async () => {
      const { data: anonRead } = await anon.from('bot_visits').select('id')
      expect(anonRead ?? []).toEqual([])
      const { error: anonWrite } = await anon
        .from('bot_visits')
        .insert({ post_id: post.id, bot_name: 'Fake', bot_category: 'ai' })
      expect(anonWrite).not.toBeNull()
      const { data: strangerRead } = await stranger.client.from('bot_visits').select('id')
      expect(strangerRead).toEqual([])
    })

    it('bot_visit_summary counts visits and distinct posts per bot for a site admin, and nothing for anyone else', async () => {
      await record(anon)
      const { data, error } = await siteAdmin.client.rpc('bot_visit_summary', { start_date: TODAY, end_date: TODAY })
      expect(error).toBeNull()
      expect(data.find((r) => r.bot_name === BOT)).toMatchObject({ bot_category: 'ai', visits: 2, posts: 1 })

      const { data: strangerData } = await stranger.client.rpc('bot_visit_summary', {
        start_date: TODAY,
        end_date: TODAY,
      })
      expect(strangerData).toEqual([])
    })
  })
})
