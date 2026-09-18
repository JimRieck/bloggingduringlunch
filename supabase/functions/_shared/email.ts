// Thin wrapper around Resend's REST API -- the only outbound email path
// in this repo that isn't a Supabase Auth template (invite/confirm/
// reset), so callers own the subject/body themselves. Missing
// RESEND_API_KEY throws 'not_configured', same shape as every other
// "missing API key" case in this repo's Edge Functions; callers should
// treat a failure here as non-fatal to whatever DB write triggered the
// email (a suggestion still gets saved/updated even if the email
// couldn't be sent) rather than let it fail the whole request.
const RESEND_API_URL = 'https://api.resend.com/emails'

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) throw new Error('not_configured')

  // Resend's shared testing domain works with zero setup, but in
  // sandbox mode (no verified sending domain yet) can only deliver to
  // the Resend account's own owner email -- real recipients need
  // RESEND_FROM_EMAIL set to an address on a verified domain.
  const from = Deno.env.get('RESEND_FROM_EMAIL') ?? 'Blogging During Lunch <onboarding@resend.dev>'

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`resend_failed: ${res.status} ${text}`)
  }
}
