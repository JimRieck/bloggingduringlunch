// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers suggest-post-description (the editor's "Write with AI" button
// next to a post's description) and its ai_description_generation flag:
// switched off it refuses the call, and every press that reaches the AI
// step is recorded in ai_usage_events as "description".
//
// Like ai-usage.test.js, the call that reaches the AI step does whatever
// the local stack is configured for: no ANTHROPIC_API_KEY (CI) records a
// `not_configured` failure; with a key it makes one very small Haiku
// request. The assertions hold either way.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const FLAG = 'ai_description_generation'

const createdUserIds = []
const createdOrgIds = []

async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('suggest-post-description', { body })
  if (error instanceof FunctionsHttpError) {
    return { ok: false, status: error.context.status, body: await error.context.json().catch(() => null) }
  }
  return { ok: true, status: 200, body: data }
}

function eventsFor(userId) {
  return adminClient.from('ai_usage_events').select('feature, succeeded, error_code').eq('user_id', userId)
}

describe('AI description writing', () => {
  let client
  let userId
  let originalEnabled

  beforeAll(async () => {
    const { data: flag } = await adminClient.from('feature_flags').select('enabled').eq('key', FLAG).single()
    originalEnabled = flag.enabled

    client = createTestClient()
    const email = `ai-desc.${runId}@example.com`
    const { data: result, error } = await client.auth.signUp({
      email,
      password: 'password123',
      options: { data: { username: `ai-desc-${runId}`, user_type: 'author', new_organization_name: `AI Desc ${runId}` } },
    })
    if (error) throw error
    createdUserIds.push(result.user.id)
    await confirmSignup(client, email)
    userId = result.user.id
    const { data: membership } = await client.from('memberships').select('organization_id').eq('user_id', userId).single()
    createdOrgIds.push(membership.organization_id)
  })

  afterAll(async () => {
    await adminClient.from('feature_flags').update({ enabled: originalEnabled }).eq('key', FLAG)
    await cleanupTestData(createdOrgIds, createdUserIds)
  })

  it('the flag exists, so it shows on /admin, and is off until an admin turns it on', async () => {
    const { data } = await createTestClient().from('feature_flags').select('key').eq('key', FLAG)
    expect(data).toEqual([{ key: FLAG }])
  })

  it("refuses the call while switched off, and records nothing for it or for an empty post", async () => {
    await adminClient.from('feature_flags').update({ enabled: false }).eq('key', FLAG)
    const disabled = await invoke(client, { title: 'A title', content: 'Body' })
    expect(disabled.status).toBe(403)

    await adminClient.from('feature_flags').update({ enabled: true }).eq('key', FLAG)
    const empty = await invoke(client, { title: 'A title', content: '   ' })
    expect(empty.status).toBe(400)

    const { data } = await eventsFor(userId)
    expect(data).toEqual([])
  })

  it(
    'records exactly one usage row per press, with the outcome, and any description fits the field',
    async () => {
      await adminClient.from('feature_flags').update({ enabled: true }).eq('key', FLAG)
      const result = await invoke(client, {
        title: 'Shipping on my lunch break',
        content: 'Thirty focused minutes a day, every weekday, is enough to ship a side project.',
      })

      const { data } = await eventsFor(userId)
      expect(data).toEqual([
        { feature: 'description', succeeded: result.ok, error_code: result.ok ? null : result.body.error },
      ])
      if (result.ok) {
        expect(result.body.description.length).toBeGreaterThan(0)
        expect(result.body.description.length).toBeLessThanOrEqual(150)
      }
    },
    60000,
  )
})
