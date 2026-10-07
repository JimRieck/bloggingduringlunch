import { describe, expect, it } from 'vitest'
import { BATCH_SIZE, sendBatchEmails } from '../../../../supabase/functions/_shared/batchEmail.ts'

// The batching used by the send-announcement Edge Function, tested here
// with a fake `fetch` -- no email leaves the machine.
function fakeResend(statuses = []) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const status = statuses[calls.length - 1] ?? 200
    return new Response(status === 200 ? '{"data":[]}' : 'nope', { status })
  }
  return { calls, fetchImpl }
}

const recipients = (n) => Array.from({ length: n }, (_, i) => `user${i}@example.com`)
const noPause = async () => {}

function send(fetchImpl, count, extra = {}) {
  return sendBatchEmails({
    apiKey: 'test-key',
    apiBase: 'https://resend.test',
    from: 'BDL <noreply@example.com>',
    subject: 'Hello',
    html: '<p>Hi</p>',
    text: 'Hi',
    recipients: recipients(count),
    fetchImpl,
    pause: noPause,
    ...extra,
  })
}

describe('sendBatchEmails', () => {
  it('sends one separate message per recipient, so nobody sees anyone else’s address', async () => {
    const { calls, fetchImpl } = fakeResend()
    await send(fetchImpl, 3)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://resend.test/emails/batch')
    expect(calls[0].init.headers.Authorization).toBe('Bearer test-key')
    expect(calls[0].body.map((m) => m.to)).toEqual([['user0@example.com'], ['user1@example.com'], ['user2@example.com']])
    expect(calls[0].body[0]).toMatchObject({ from: 'BDL <noreply@example.com>', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
  })

  it(`splits into requests of at most ${BATCH_SIZE}`, async () => {
    const { calls, fetchImpl } = fakeResend()
    const result = await send(fetchImpl, 250)
    expect(calls.map((c) => c.body.length)).toEqual([100, 100, 50])
    expect(result).toEqual({ sent: 250, failed: 0 })
  })

  it('counts a failed request’s recipients as failed and carries on with the rest', async () => {
    const { calls, fetchImpl } = fakeResend([200, 500, 200])
    const result = await send(fetchImpl, 250)
    expect(calls).toHaveLength(3)
    expect(result).toEqual({ sent: 150, failed: 100 })
  })

  it('treats a network error the same way', async () => {
    let call = 0
    const fetchImpl = async () => {
      call += 1
      if (call === 1) throw new Error('connection reset')
      return new Response('{}', { status: 200 })
    }
    expect(await send(fetchImpl, 150)).toEqual({ sent: 50, failed: 100 })
  })

  it('retries once when rate-limited', async () => {
    const { calls, fetchImpl } = fakeResend([429, 200])
    expect(await send(fetchImpl, 10)).toEqual({ sent: 10, failed: 0 })
    expect(calls).toHaveLength(2)
  })

  it('pauses between requests, but not before the first', async () => {
    const pauses = []
    const { fetchImpl } = fakeResend()
    await send(fetchImpl, 250, { pause: async (ms) => pauses.push(ms) })
    expect(pauses).toEqual([600, 600])
  })

  it('sends nothing for an empty list', async () => {
    const { calls, fetchImpl } = fakeResend()
    expect(await send(fetchImpl, 0)).toEqual({ sent: 0, failed: 0 })
    expect(calls).toHaveLength(0)
  })
})
