import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { sendEmail } from '../_shared/email.ts'

const VALID_STATUSES = ['new', 'under_review', 'planned', 'completed', 'declined']
const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  under_review: 'Under review',
  planned: 'Planned',
  completed: 'Completed',
  declined: 'Declined',
}

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

  let body: { suggestionId?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const suggestionId = typeof body.suggestionId === 'string' ? body.suggestionId : ''
  const status = typeof body.status === 'string' ? body.status : ''
  if (!suggestionId || !VALID_STATUSES.includes(status)) {
    return json({ error: 'invalid_body' }, 400)
  }

  // Caller-scoped, not service-role -- "Site admins can update
  // suggestion status" RLS (is_site_admin()) is exactly the check this
  // needs; a non-admin caller updates zero rows and .single() below
  // turns that into a clean error rather than a silent no-op.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: suggestion, error: updateError } = await callerClient
    .from('suggestions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .select('id, user_id, content, status')
    .single()
  if (updateError || !suggestion) {
    return json({ error: 'forbidden' }, 403)
  }

  // Best-effort, same reasoning as submit-suggestion -- the status
  // change is already saved by this point. Site admins can already read
  // any profile ("Site admins can view all profiles"), so this stays on
  // the caller-scoped client rather than needing service-role.
  try {
    const { data: profile } = await callerClient
      .from('profiles')
      .select('display_name, email')
      .eq('id', suggestion.user_id)
      .maybeSingle()
    if (profile?.email) {
      const name = profile.display_name || profile.email
      const label = STATUS_LABELS[status] ?? status
      await sendEmail({
        to: profile.email,
        subject: 'Update on your suggestion',
        html: `<p>Hi ${name},</p><p>The status of your suggestion:</p><blockquote>${escapeHtml(suggestion.content)}</blockquote><p>has been updated to: <strong>${label}</strong>.</p><p>&mdash; Blogging During Lunch</p>`,
      })
    }
  } catch (err) {
    console.error('update-suggestion-status: notification email failed', err)
  }

  return json({ suggestion })
})

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
