import { json } from '../_shared/response.ts'
import { getFeatureFlags } from '../_shared/featureFlags.ts'
import { runSchedule, serviceClient, type ScheduleRow } from '../_shared/linkedin.ts'

const BATCH_SIZE = 20

// Called every minute by pg_cron (see the end of
// 20260921100000_linkedin_scheduled_posts.sql) -- and only when a
// schedule is actually due. verify_jwt is off in config.toml: the caller
// proves itself with the shared secret pg_cron reads from Vault, checked
// here through an RPC so the secret never has to live in this function's
// environment.
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const secret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const admin = serviceClient()
  const { data: valid } = await admin.rpc('check_social_cron_secret', { p_secret: secret })
  if (valid !== true) {
    return json({ error: 'unauthorized' }, 401)
  }

  const { linkedin_posting: enabled } = await getFeatureFlags(['linkedin_posting'])
  if (!enabled) {
    // Flag off = nothing posts. Due schedules simply wait.
    return json({ skipped: 'feature_disabled' })
  }

  const { data: claimed, error } = await admin.rpc('claim_due_social_posts', { max_rows: BATCH_SIZE })
  if (error) {
    console.error('linkedin-process-due: claim failed', error.message)
    return json({ error: 'claim_failed' }, 500)
  }

  // Sequential on purpose: a batch is small, and one slow or rate-limited
  // LinkedIn response shouldn't fan out into a burst of concurrent calls.
  const rows = (claimed ?? []) as ScheduleRow[]
  let posted = 0
  let failed = 0
  for (const row of rows) {
    const result = await runSchedule(admin, row)
    if (result.ok) posted += 1
    else failed += 1
  }

  return json({ processed: rows.length, posted, failed })
})
