import { createClient } from 'jsr:@supabase/supabase-js@2'

// Records one AI request in ai_usage_events (shown on /admin). Uses the
// service-role key because no client role can write to that table.
// `errorCode` is the same code the function returns to the browser, or
// null for a request that succeeded. Never throws: a tracking failure
// must not turn a working AI request into a failed one.
export async function recordAiUsage(userId: string, feature: string, errorCode: string | null = null) {
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    })
    const { error } = await admin.from('ai_usage_events').insert({
      user_id: userId,
      feature,
      succeeded: errorCode === null,
      error_code: errorCode,
    })
    if (error) console.error('recordAiUsage failed:', error.message)
  } catch (err) {
    console.error('recordAiUsage failed:', err)
  }
}
