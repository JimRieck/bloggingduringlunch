import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'

// Removes every authenticator a user has set up, for someone who lost
// their phone. Two-factor is required for everyone, and Supabase has no
// backup codes, so without this a lost device means a locked account.
// After a reset, the user's next login takes them through setup again.
// Site admins only, and not on their own account.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let userId: unknown
  try {
    ;({ userId } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof userId !== 'string' || !userId) {
    return json({ error: 'invalid_body' }, 400)
  }

  const caller = await getCaller(req)
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (userId === caller.id) {
    return json({ error: 'cannot_reset_self' }, 403)
  }

  const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('is_site_admin')
    .eq('id', caller.id)
    .maybeSingle()
  if (!callerProfile?.is_site_admin) {
    return json({ error: 'not_a_site_admin' }, 403)
  }

  const { data: factorList, error: listError } = await adminClient.auth.admin.mfa.listFactors({ userId })
  if (listError) {
    console.error('admin-reset-mfa: listFactors failed', listError)
    return json({ error: 'reset_failed' }, 500)
  }

  for (const factor of factorList.factors) {
    const { error: deleteError } = await adminClient.auth.admin.mfa.deleteFactor({ id: factor.id, userId })
    if (deleteError) {
      console.error('admin-reset-mfa: deleteFactor failed', deleteError)
      return json({ error: 'reset_failed' }, 500)
    }
  }

  return json({ ok: true, removed: factorList.factors.length })
})
