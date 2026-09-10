// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers the two Postgres RPCs from
// 20260910125019_site_stats_aggregate_rpcs.sql that back the admin
// page's site traffic chart (SiteStats.jsx): site_views_by_day groups
// and sums post_views by calendar day (zero-filled across the full
// range), site_views_by_author does the same per author for a single
// day. Both are `security invoker` (no `security definer`), so they
// stay subject to post_views' existing RLS exactly like a plain
// select would -- an admin sees the real site-wide picture, a
// non-admin/non-member only ever sees their own org's slice, verified
// here rather than just assumed.
//
// Uses a fixed, far-past date range (Jan 2026) for all assertions --
// site_views_by_day is genuinely site-wide, so this keeps the counts
// exact regardless of what any other suite inserts around "now"
// (every other suite backdates nothing; it all stamps real "now()").
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const day1 = '2026-01-01'
const day2 = '2026-01-02'

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

describe('site stats RPCs: site_views_by_day / site_views_by_author', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let adminAuthClient
  let authorId
  let strangerClient

  beforeAll(async () => {
    const authorClient = createTestClient()
    const { user: author } = await signUp(authorClient, emailFor('stats-author'), {
      username: 'stats-author-' + runId,
      user_type: 'author',
      new_organization_name: 'Stats Org ' + runId,
    })
    authorId = author.id
    const { data: membership } = await authorClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', authorId)
      .single()
    createdOrgIds.push(membership.organization_id)

    const { data: post } = await authorClient
      .from('posts')
      .insert({
        organization_id: membership.organization_id,
        author_id: authorId,
        title: 'Stats Test Post ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    // Backdated via the service-role client -- a real (anon/reader)
    // insert always stamps `now()`, and these assertions need known,
    // controllable days.
    await adminClient.from('post_views').insert([
      { post_id: post.id, viewed_at: `${day1}T09:00:00Z` },
      { post_id: post.id, viewed_at: `${day1}T10:00:00Z` },
      { post_id: post.id, viewed_at: `${day2}T09:00:00Z` },
    ])

    const bootstrapAdmin = createTestClient()
    const { user: adminUser } = await signUp(bootstrapAdmin, emailFor('stats-admin'), {
      username: 'stats-admin-' + runId,
      user_type: 'author',
      new_organization_name: 'Stats Admin Org ' + runId,
    })
    const { data: adminMembership } = await bootstrapAdmin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', adminUser.id)
      .single()
    createdOrgIds.push(adminMembership.organization_id)
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', adminUser.id)

    adminAuthClient = createTestClient()
    await adminAuthClient.auth.signInWithPassword({ email: emailFor('stats-admin'), password: PASSWORD })

    strangerClient = createTestClient()
    await signUp(strangerClient, emailFor('stats-stranger'), {
      username: 'stats-stranger-' + runId,
      user_type: 'reader',
    })
  })

  it('site_views_by_day returns one zero-filled row per day in range, correctly summed', async () => {
    const { data, error } = await adminAuthClient.rpc('site_views_by_day', {
      start_date: '2025-12-30',
      end_date: '2026-01-03',
    })
    expect(error).toBeNull()
    expect(data).toEqual([
      { day: '2025-12-30', views: 0 },
      { day: '2025-12-31', views: 0 },
      { day: day1, views: 2 },
      { day: day2, views: 1 },
      { day: '2026-01-03', views: 0 },
    ])
  })

  it('site_views_by_author groups a single day by author with the right display name', async () => {
    const { data, error } = await adminAuthClient.rpc('site_views_by_author', { target_date: day1 })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ author_id: authorId, views: 2 })
    expect(data[0].display_name).toBeTruthy()
  })

  it("a non-admin, non-member caller's RLS boundary holds through the RPC too", async () => {
    const { data: dayData, error: dayError } = await strangerClient.rpc('site_views_by_day', {
      start_date: day1,
      end_date: day1,
    })
    expect(dayError).toBeNull()
    expect(dayData).toEqual([{ day: day1, views: 0 }])

    const { data: authorData, error: authorError } = await strangerClient.rpc('site_views_by_author', {
      target_date: day1,
    })
    expect(authorError).toBeNull()
    expect(authorData).toEqual([])
  })
})
