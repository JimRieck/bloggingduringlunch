// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// 20261019100000_eastern_time_day_boundaries.sql: every stats RPC splits
// days at midnight Eastern (America/New_York), not midnight UTC. The
// bug it fixes: a view after 8pm Eastern (midnight UTC in summer) was
// counted on the next day. Uses fixed past dates, in winter (EST,
// UTC-5) and summer (EDT, UTC-4), so the counts are exact.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

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

describe('Eastern-time day boundaries', () => {
  let author
  let siteAdmin
  let postId

  beforeAll(async () => {
    author = await newUser('et-author', { user_type: 'author', new_organization_name: `ET Org ${runId}` })
    const { data: membership } = await adminClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', author.id)
      .single()
    createdOrgIds.push(membership.organization_id)
    const { data: post } = await author.client
      .from('posts')
      .insert({
        organization_id: membership.organization_id,
        author_id: author.id,
        title: `ET post ${runId}`,
        content: '<p>x</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    postId = post.id

    siteAdmin = await newUser('et-admin', { user_type: 'author', new_organization_name: `ET Admin Org ${runId}` })
    const { data: adminMembership } = await adminClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', siteAdmin.id)
      .single()
    createdOrgIds.push(adminMembership.organization_id)
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)

    const { error } = await adminClient.from('post_views').insert([
      // Winter (EST, UTC-5): 9:30pm Mar 4 Eastern = 02:30 UTC Mar 5.
      { post_id: postId, viewed_at: '2026-03-05T02:30:00Z' },
      // 12:30am Mar 5 Eastern.
      { post_id: postId, viewed_at: '2026-03-05T05:30:00Z' },
      // Summer (EDT, UTC-4): 11:30pm Jul 9 Eastern = 03:30 UTC Jul 10.
      { post_id: postId, viewed_at: '2026-07-10T03:30:00Z' },
      // 12:15am Jul 10 Eastern.
      { post_id: postId, viewed_at: '2026-07-10T04:15:00Z' },
    ])
    if (error) throw error
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  it('site_day_start is midnight Eastern: 05:00 UTC in winter, 04:00 UTC in summer', async () => {
    const { data: winter } = await adminClient.rpc('site_day_start', { d: '2026-01-15' })
    const { data: summer } = await adminClient.rpc('site_day_start', { d: '2026-07-15' })
    expect(new Date(winter).toISOString()).toBe('2026-01-15T05:00:00.000Z')
    expect(new Date(summer).toISOString()).toBe('2026-07-15T04:00:00.000Z')
  })

  it('a late-evening view counts on its own Eastern day, not the next one (site traffic chart)', async () => {
    const { data } = await siteAdmin.client.rpc('site_views_by_day', { start_date: '2026-03-04', end_date: '2026-03-05' })
    expect(data).toEqual([
      { day: '2026-03-04', views: 1 },
      { day: '2026-03-05', views: 1 },
    ])
    const { data: summer } = await siteAdmin.client.rpc('site_views_by_day', {
      start_date: '2026-07-09',
      end_date: '2026-07-10',
    })
    expect(summer).toEqual([
      { day: '2026-07-09', views: 1 },
      { day: '2026-07-10', views: 1 },
    ])
  })

  it('the same holds for a single day and the per-post drill-down', async () => {
    const { data: byAuthor } = await siteAdmin.client.rpc('site_views_by_author', { target_date: '2026-07-09' })
    expect(byAuthor.find((r) => r.author_id === author.id)?.views).toBe(1)
    const { data: byPost } = await siteAdmin.client.rpc('site_views_by_post', {
      start_date: '2026-07-09',
      end_date: '2026-07-09',
    })
    expect(byPost.find((r) => r.post_id === postId)?.views).toBe(1)
  })

  it('and for the author’s own My stats', async () => {
    const { data: byDay } = await author.client.rpc('my_post_views_by_day', {
      target_post_id: postId,
      start_date: '2026-03-04',
      end_date: '2026-03-05',
    })
    expect(byDay).toEqual([
      { day: '2026-03-04', views: 1 },
      { day: '2026-03-05', views: 1 },
    ])
    const { data: byPost } = await author.client.rpc('my_post_views_by_post', {
      post_ids: [postId],
      start_date: '2026-03-04',
      end_date: '2026-03-04',
    })
    expect(byPost).toEqual([{ post_id: postId, views: 1 }])
  })

  it('and for traffic sources', async () => {
    const { data } = await siteAdmin.client.rpc('site_traffic_sources', { start_date: '2026-03-04', end_date: '2026-03-04' })
    expect(data.reduce((sum, r) => sum + r.views, 0)).toBe(1)
  })
})
