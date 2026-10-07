// Sends the same email to many people through Resend's batch endpoint:
// one separate message per recipient (nobody sees anyone else's
// address), up to 100 per request. A request that fails counts all of
// its recipients as failed and the rest carry on. Free of Deno-only
// APIs (fetch and the pause are injectable) so the web app's Vitest
// suite can unit-test it directly.
export const BATCH_SIZE = 100

type Options = {
  apiKey: string
  apiBase?: string
  from: string
  subject: string
  html: string
  text: string
  recipients: string[]
  fetchImpl?: typeof fetch
  pause?: (ms: number) => Promise<void>
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function sendBatchEmails({
  apiKey,
  apiBase = 'https://api.resend.com',
  from,
  subject,
  html,
  text,
  recipients,
  fetchImpl = fetch,
  pause = wait,
}: Options): Promise<{ sent: number; failed: number }> {
  let sent = 0
  let failed = 0

  for (let start = 0; start < recipients.length; start += BATCH_SIZE) {
    const chunk = recipients.slice(start, start + BATCH_SIZE)
    // Resend allows a handful of requests per second; a short gap keeps
    // a long send under that.
    if (start > 0) await pause(600)

    const send = () =>
      fetchImpl(`${apiBase}/emails/batch`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((to) => ({ from, to: [to], subject, html, text }))),
      })

    try {
      let res = await send()
      if (res.status === 429) {
        await pause(1500)
        res = await send()
      }
      if (res.ok) {
        sent += chunk.length
      } else {
        failed += chunk.length
        console.error('sendBatchEmails: batch failed', res.status, await res.text().catch(() => ''))
      }
    } catch (err) {
      failed += chunk.length
      console.error('sendBatchEmails: batch failed', err)
    }
  }

  return { sent, failed }
}
