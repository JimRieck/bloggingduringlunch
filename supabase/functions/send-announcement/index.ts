import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { sendBatchEmails } from '../_shared/batchEmail.ts'

// Sends a saved announcement draft (see 20261007100000_announcements.sql)
// to every active user not unchecked on it, or with `test: true` only to
// the calling admin
// (subject prefixed "[Test]", draft left as is). Site admins only.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const caller = await getCaller(req)
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: { announcementId?: unknown; test?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const announcementId = typeof body.announcementId === 'string' ? body.announcementId : ''
  const test = body.test === true
  if (!announcementId) {
    return json({ error: 'invalid_body' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('is_site_admin')
    .eq('id', caller.id)
    .maybeSingle()
  if (!callerProfile?.is_site_admin) {
    return json({ error: 'not_a_site_admin' }, 403)
  }

  const { data: announcement } = await admin
    .from('announcements')
    .select('id, subject, email_html, email_text, status, excluded_user_ids')
    .eq('id', announcementId)
    .maybeSingle()
  if (!announcement) {
    return json({ error: 'not_found' }, 404)
  }
  if (announcement.status !== 'draft') {
    return json({ error: 'already_sent' }, 409)
  }
  if (!announcement.subject.trim() || !announcement.email_html.trim()) {
    return json({ error: 'empty_announcement' }, 400)
  }

  // Every active user except the ones unchecked on the draft. Worked out
  // before claiming the draft, so "nobody selected" leaves it a draft.
  let recipients: string[] = []
  if (!test) {
    const { data: recipientRows, error: recipientError } = await admin.rpc('announcement_recipients')
    if (recipientError) {
      console.error('send-announcement: recipients failed', recipientError)
      return json({ error: 'send_failed' }, 500)
    }
    const excluded = new Set<string>(announcement.excluded_user_ids ?? [])
    recipients = (recipientRows ?? [])
      .filter((r: { user_id: string }) => !excluded.has(r.user_id))
      .map((r: { email: string }) => r.email)
    if (recipients.length === 0) {
      return json({ error: 'no_recipients' }, 400)
    }
  }

  // Checked before claiming the draft, so a missing key can't leave it
  // stuck in "sending".
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    return json({ error: 'not_configured' }, 500)
  }
  const mail = {
    apiKey,
    apiBase: Deno.env.get('RESEND_API_BASE') ?? undefined,
    from: Deno.env.get('RESEND_FROM_EMAIL') ?? 'Blogging During Lunch <onboarding@resend.dev>',
    html: announcement.email_html,
    text: announcement.email_text,
  }

  if (test) {
    const result = await sendBatchEmails({
      ...mail,
      subject: `[Test] ${announcement.subject}`,
      recipients: [caller.email!],
    })
    return result.sent === 1 ? json({ ok: true, sent: 1 }) : json({ error: 'send_failed' }, 502)
  }

  const { data: claimed, error: claimError } = await admin.rpc('claim_announcement_for_sending', {
    p_id: announcementId,
    p_sent_by: caller.id,
  })
  if (claimError) {
    console.error('send-announcement: claim failed', claimError)
    return json({ error: 'send_failed' }, 500)
  }
  if (!claimed?.length) {
    return json({ error: 'already_sent' }, 409)
  }

  const { sent, failed } = await sendBatchEmails({ ...mail, subject: announcement.subject, recipients })

  // Nothing went out at all (e.g. Resend rejected every request): put it
  // back to a draft so it can be retried, rather than record a send that
  // never happened. A partial failure is recorded as sent, with the count.
  if (sent === 0 && failed > 0) {
    await admin.from('announcements').update({ status: 'draft', sent_by: null }).eq('id', announcementId)
    return json({ error: 'send_failed' }, 502)
  }

  await admin
    .from('announcements')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      recipient_count: sent,
      failed_count: failed,
    })
    .eq('id', announcementId)

  return json({ ok: true, sent, failed })
})
