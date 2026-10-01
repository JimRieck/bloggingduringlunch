// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261001100000_ai_usage_tracking.sql (who can read/write
// ai_usage_events, and the two aggregate RPCs behind the admin page's
// "AI usage" section) plus the recording itself: a real call to an AI
// Edge Function has to leave exactly one row behind.
//
// The RPC assertions use a fixed, far-past date range (Feb 2026) so the
// counts stay exact no matter what else has been recorded around "now".
//
// The one Edge Function call that reaches the AI step does whatever the
// local stack is configured for: with no ANTHROPIC_API_KEY (CI) it
// records a `not_configured` failure; with a key (a dev machine) it
// makes one real, very small Haiku request. The assertions hold either
// way -- what's under test is that the outcome is recorded, not the AI.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'
const day1 = '2026-02-01'
const day2 = '2026-02-02'
const FLAG_KEYS = ['ai_tag_generation', 'ai_category_generation']

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
  return { client, id: user.id }
}

async function invoke(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body })
  if (error instanceof FunctionsHttpError) {
    return { ok: false, status: error.context.status, body: await error.context.json().catch(() => null) }
  }
  return { ok: true, status: 200, body: data }
}

function eventsFor(userId) {
  return adminClient.from('ai_usage_events').select('feature, succeeded, error_code').eq('user_id', userId)
}

describe('AI usage tracking', () => {
  let siteAdmin
  let heavyUser
  let lightUser
  let caller
  let originalFlags

  beforeAll(async () => {
    const { data: flagRows } = await adminClient.from('feature_flags').select('key, enabled').in('key', FLAG_KEYS)
    originalFlags = flagRows

    siteAdmin = await newAuthor('ai-admin')
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)
    heavyUser = await newAuthor('ai-heavy')
    lightUser = await newAuthor('ai-light')
    caller = await newAuthor('ai-caller')

    // Backdated via the service-role client, the same way the Edge
    // Functions write (they just always stamp now()).
    const { error } = await adminClient.from('ai_usage_events').insert([
      { user_id: heavyUser.id, feature: 'titles', succeeded: true, created_at: `${day1}T09:00:00Z` },
      { user_id: heavyUser.id, feature: 'titles', succeeded: true, created_at: `${day1}T10:00:00Z` },
      {
        user_id: heavyUser.id,
        feature: 'image',
        succeeded: false,
        error_code: 'generation_failed',
        created_at: `${day2}T09:00:00Z`,
      },
      { user_id: lightUser.id, feature: 'titles', succeeded: true, created_at: `${day2}T23:59:59Z` },
      // Just outside the range on either side -- must not be counted.
      { user_id: lightUser.id, feature: 'titles', succeeded: true, created_at: '2026-01-31T23:59:59Z' },
      { user_id: lightUser.id, feature: 'titles', succeeded: true, created_at: '2026-02-03T00:00:00Z' },
    ])
    if (error) throw error
  })

  afterAll(async () => {
    for (const flag of originalFlags ?? []) {
      await adminClient.from('feature_flags').update({ enabled: flag.enabled }).eq('key', flag.key)
    }
    // ai_usage_events rows go with their users (on delete cascade).
    await cleanupTestData(createdOrgIds, createdUserIds)
  })

  it('ai_usage_by_feature counts requests, failures and distinct users per feature, inclusive of both end dates', async () => {
    const { data, error } = await siteAdmin.client.rpc('ai_usage_by_feature', { start_date: day1, end_date: day2 })
    expect(error).toBeNull()
    expect(data).toEqual([
      { feature: 'titles', calls: 3, failed: 0, users: 2 },
      { feature: 'image', calls: 1, failed: 1, users: 1 },
    ])
  })

  it('ai_usage_by_user lists the heaviest user first, with their name, email and last use', async () => {
    const { data, error } = await siteAdmin.client.rpc('ai_usage_by_user', { start_date: day1, end_date: day2 })
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      user_id: heavyUser.id,
      email: emailFor('ai-heavy'),
      calls: 3,
      failed: 1,
    })
    expect(data[0].display_name).toBeTruthy()
    expect(new Date(data[0].last_used_at).toISOString()).toBe(`${day2}T09:00:00.000Z`)
    expect(data[1]).toMatchObject({ user_id: lightUser.id, calls: 1, failed: 0 })
  })

  it('a single-day range only counts that day', async () => {
    const { data } = await siteAdmin.client.rpc('ai_usage_by_feature', { start_date: day1, end_date: day1 })
    expect(data).toEqual([{ feature: 'titles', calls: 2, failed: 0, users: 1 }])
  })

  it("a non-admin can't read usage, not even their own, through the table or either RPC", async () => {
    const { data: rows, error: selectError } = await heavyUser.client.from('ai_usage_events').select('id')
    expect(selectError).toBeNull()
    expect(rows).toEqual([])

    const args = { start_date: day1, end_date: day2 }
    const { data: byFeature } = await heavyUser.client.rpc('ai_usage_by_feature', args)
    expect(byFeature).toEqual([])
    const { data: byUser } = await heavyUser.client.rpc('ai_usage_by_user', args)
    expect(byUser).toEqual([])
  })

  it("no client can write a usage row directly, not even a site admin -- only the Edge Functions' service role", async () => {
    for (const author of [heavyUser, siteAdmin]) {
      const { error } = await author.client
        .from('ai_usage_events')
        .insert({ user_id: author.id, feature: 'titles', succeeded: true })
      expect(error).not.toBeNull()
    }
    const { data } = await eventsFor(siteAdmin.id)
    expect(data).toEqual([])
  })

  it("an AI function records nothing when it's switched off or the request is invalid", async () => {
    for (const key of FLAG_KEYS) await adminClient.from('feature_flags').update({ enabled: false }).eq('key', key)
    const disabled = await invoke(caller.client, 'suggest-tags-and-categories', { title: 'A title', content: 'Body' })
    expect(disabled.status).toBe(403)

    await adminClient.from('feature_flags').update({ enabled: true }).eq('key', 'ai_tag_generation')
    const invalid = await invoke(caller.client, 'suggest-tags-and-categories', { title: '', content: '' })
    expect(invalid.status).toBe(400)

    const { data } = await eventsFor(caller.id)
    expect(data).toEqual([])
  })

  it(
    'an AI function records exactly one row per request, with the outcome it returned and the bulk label',
    async () => {
      await adminClient.from('feature_flags').update({ enabled: true }).eq('key', 'ai_tag_generation')
      const result = await invoke(caller.client, 'suggest-tags-and-categories', {
        title: 'Recording AI usage in Postgres',
        content: 'A short post about adding a usage table and two aggregate functions.',
        existingCategories: [],
        existingTags: [],
        source: 'bulk',
      })

      const { data } = await eventsFor(caller.id)
      expect(data).toEqual([
        { feature: 'bulk_auto_tag', succeeded: result.ok, error_code: result.ok ? null : result.body.error },
      ])
    },
    60000,
  )
})
