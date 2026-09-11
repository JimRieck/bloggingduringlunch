// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers the two Postgres RPCs from
// 20260910190823_my_stats_aggregate_rpcs.sql that back the author-
// facing "My stats" chart (MyStats.jsx): my_post_views_by_post groups
// and sums post_views per post (zero-filled for a post with no
// views), my_post_views_by_day does the same per calendar day for a
// single post. Both are `security invoker` (no `security definer`),
// so they stay subject to post_views' existing RLS exactly like a
// plain select would -- an author calling with another org's post id
// gets a zero-filled row for it, not that org's real numbers or an
// error, verified here rather than just assumed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const day1 = '2026-02-01'
const day2 = '2026-02-02'

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

describe('my stats RPCs: my_post_views_by_post / my_post_views_by_day', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  let authorClient
  let post1Id
  let post2Id
  let strangerClient
  let strangerPostId

  beforeAll(async () => {
    authorClient = createTestClient()
    const { user: author } = await signUp(authorClient, emailFor('mystats-author'), {
      username: 'mystats-author-' + runId,
      user_type: 'author',
      new_organization_name: 'My Stats Org ' + runId,
    })
    const { data: membership } = await authorClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', author.id)
      .single()
    createdOrgIds.push(membership.organization_id)

    const { data: post1 } = await authorClient
      .from('posts')
      .insert({
        organization_id: membership.organization_id,
        author_id: author.id,
        title: 'My Stats Post One ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    post1Id = post1.id

    const { data: post2 } = await authorClient
      .from('posts')
      .insert({
        organization_id: membership.organization_id,
        author_id: author.id,
        title: 'My Stats Post Two ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    post2Id = post2.id

    // Backdated via the service-role client -- a real reader/anon
    // insert always stamps `now()`, and these assertions need known,
    // controllable days.
    await adminClient.from('post_views').insert([
      { post_id: post1Id, viewed_at: `${day1}T09:00:00Z` },
      { post_id: post1Id, viewed_at: `${day2}T09:00:00Z` },
      { post_id: post2Id, viewed_at: `${day1}T09:00:00Z` },
    ])

    strangerClient = createTestClient()
    const { user: stranger } = await signUp(strangerClient, emailFor('mystats-stranger'), {
      username: 'mystats-stranger-' + runId,
      user_type: 'author',
      new_organization_name: 'My Stats Stranger Org ' + runId,
    })
    const { data: strangerMembership } = await strangerClient
      .from('memberships')
      .select('organization_id')
      .eq('user_id', stranger.id)
      .single()
    createdOrgIds.push(strangerMembership.organization_id)

    const { data: strangerPost } = await strangerClient
      .from('posts')
      .insert({
        organization_id: strangerMembership.organization_id,
        author_id: stranger.id,
        title: 'Stranger Post ' + runId,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    strangerPostId = strangerPost.id

    // This one genuinely has a view on day1 -- the RLS test below
    // needs a real, non-zero count to be hidden, not just an
    // incidentally-empty post that would zero-fill either way.
    await adminClient.from('post_views').insert({ post_id: strangerPostId, viewed_at: `${day1}T09:00:00Z` })
  })

  it('my_post_views_by_post sums each post correctly and zero-fills a post with no views', async () => {
    const { data, error } = await authorClient.rpc('my_post_views_by_post', {
      post_ids: [post1Id, post2Id],
      start_date: '2026-01-30',
      end_date: '2026-02-03',
    })
    expect(error).toBeNull()
    const byId = Object.fromEntries(data.map((r) => [r.post_id, r.views]))
    expect(byId[post1Id]).toBe(2)
    expect(byId[post2Id]).toBe(1)
  })

  it('my_post_views_by_day returns one zero-filled row per day for a single post', async () => {
    const { data, error } = await authorClient.rpc('my_post_views_by_day', {
      target_post_id: post1Id,
      start_date: '2026-01-31',
      end_date: '2026-02-03',
    })
    expect(error).toBeNull()
    expect(data).toEqual([
      { day: '2026-01-31', views: 0 },
      { day: day1, views: 1 },
      { day: day2, views: 1 },
      { day: '2026-02-03', views: 0 },
    ])
  })

  it("RLS holds through both RPCs -- another org's post yields a zero-filled row, not its real count", async () => {
    const { data: postData, error: postError } = await authorClient.rpc('my_post_views_by_post', {
      post_ids: [strangerPostId],
      start_date: day1,
      end_date: day1,
    })
    expect(postError).toBeNull()
    expect(postData).toEqual([{ post_id: strangerPostId, views: 0 }])

    const { data: dayData, error: dayError } = await authorClient.rpc('my_post_views_by_day', {
      target_post_id: strangerPostId,
      start_date: day1,
      end_date: day1,
    })
    expect(dayError).toBeNull()
    expect(dayData).toEqual([{ day: day1, views: 0 }])
  })
})
