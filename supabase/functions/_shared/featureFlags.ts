import { createClient } from 'jsr:@supabase/supabase-js@2'

// Unauthenticated, anon-key read -- flag values aren't sensitive, and
// every AI Edge Function needs this same check before spending money on
// a call, regardless of who's asking. Missing rows default to disabled,
// same as "not configured yet" elsewhere in these functions: an unknown
// flag should never fail open.
export async function getFeatureFlags(keys: string[]): Promise<Record<string, boolean>> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const client = createClient(supabaseUrl, anonKey)

  const { data } = await client.from('feature_flags').select('key, enabled').in('key', keys)

  const flags: Record<string, boolean> = {}
  for (const key of keys) flags[key] = false
  for (const row of data ?? []) flags[row.key] = row.enabled
  return flags
}
