import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { getFeatureFlags } from '../_shared/featureFlags.ts'
import { runSchedule, serviceClient, type ScheduleRow } from '../_shared/linkedin.ts'

// "Post now": runs one of the caller's own schedules immediately instead
// of waiting for the next cron tick. Shares runSchedule() with the cron
// worker, so a manual run and a scheduled run behave identically.
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

  const { linkedin_posting: enabled } = await getFeatureFlags(['linkedin_posting'])
  if (!enabled) {
    return json({ error: 'feature_disabled' }, 403)
  }

  let body: { scheduleId?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const scheduleId = typeof body.scheduleId === 'string' ? body.scheduleId : ''
  if (!scheduleId) {
    return json({ error: 'invalid_body' }, 400)
  }

  // Ownership check runs under the caller's own RLS: someone else's
  // schedule id simply comes back empty.
  const callerClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: owned } = await callerClient.from('scheduled_social_posts').select('id').eq('id', scheduleId).maybeSingle()
  if (!owned) {
    return json({ error: 'not_found' }, 404)
  }

  const admin = serviceClient()
  const { data: claimed } = await admin.rpc('claim_social_post', { p_id: scheduleId })
  const row = (claimed as ScheduleRow[] | null)?.[0]
  if (!row) {
    // Already running, or not in a runnable state (paused/completed/failed).
    return json({ error: 'not_runnable' }, 409)
  }

  const result = await runSchedule(admin, row)
  return json(result)
})
