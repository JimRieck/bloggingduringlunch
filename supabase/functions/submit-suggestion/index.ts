import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/email.ts'

const MAX_CONTENT_CHARS = 4000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  const caller = await getCaller(req)
  if (!caller || !authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: { content?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    return json({ error: 'invalid_body' }, 400)
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return json({ error: 'content_too_long' }, 400)
  }

  // Caller-scoped, not service-role -- "Users can create their own
  // suggestions" RLS (auth.uid() = user_id) is exactly the check this
  // insert needs.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: suggestion, error: insertError } = await callerClient
    .from('suggestions')
    .insert({ user_id: caller.id, content })
    .select('id, content, status, created_at')
    .single()
  if (insertError) {
    return json({ error: 'insert_failed' }, 500)
  }

  // Best-effort -- the suggestion is already saved by this point, so a
  // missing/failing email provider shouldn't turn into a failed
  // request. The caller's own row is always readable, so no extra
  // permission is needed for this lookup.
  if (caller.email) {
    try {
      const { data: profile } = await callerClient
        .from('profiles')
        .select('display_name')
        .eq('id', caller.id)
        .maybeSingle()
      const name = profile?.display_name || caller.email
      await sendEmail({
        to: caller.email,
        subject: 'We received your suggestion',
        html: `<p>Hi ${name},</p><p>Thanks for your suggestion:</p><blockquote>${escapeHtml(content)}</blockquote><p>We're evaluating it and will email you when there's an update.</p><p>&mdash; Blogging During Lunch</p>`,
      })
    } catch (err) {
      console.error('submit-suggestion: confirmation email failed', err)
    }
  }

  return json({ suggestion })
})

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
