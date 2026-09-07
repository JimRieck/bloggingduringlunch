import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let userId: string | undefined
  let disabled: boolean | undefined
  try {
    ;({ userId, disabled } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (typeof userId !== 'string' || !userId || typeof disabled !== 'boolean') {
    return json({ error: 'invalid_body' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Identify the caller from their own JWT -- never trust anything the
  // client claims about who they are or whether they're an admin.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser()
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (userId === caller.id) {
    return json({ error: 'cannot_disable_self' }, 403)
  }

  // Service-role client for the privileged check/action -- bypasses RLS
  // intentionally, since this whole function is a site-admin-only action
  // already gated by the verified caller identity above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerProfile } = await adminClient
    .from('profiles')
    .select('is_site_admin')
    .eq('id', caller.id)
    .maybeSingle()
  if (!callerProfile?.is_site_admin) {
    return json({ error: 'not_a_site_admin' }, 403)
  }

  const { error: banError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: disabled ? '876000h' : 'none',
  })
  if (banError) {
    console.error('admin-set-account-status: updateUserById failed', banError)
    return json({ error: 'update_failed' }, 500)
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ disabled })
    .eq('id', userId)
  if (profileError) {
    console.error('admin-set-account-status: profile mirror update failed', profileError)
    return json({ error: 'update_failed' }, 500)
  }

  return json({ ok: true })
})
