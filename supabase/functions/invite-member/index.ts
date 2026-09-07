import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Keep in sync with src/web/src/lib/validation.js's EMAIL_PATTERN --
// Deno functions can't import across the supabase/ <-> src/web/ boundary.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  let email: string | undefined
  try {
    ;({ email } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  email = typeof email === 'string' ? email.trim() : ''
  if (!email || !EMAIL_PATTERN.test(email)) {
    return json({ error: 'invalid_email' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Identify the caller from their own JWT -- never trust anything the
  // client claims about who they are or which org they own.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser()
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Service-role client for the privileged lookup/invite -- bypasses RLS
  // intentionally, since this whole function is an owner-only action
  // already gated by the verified caller identity above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: org } = await adminClient
    .from('organizations')
    .select('id, invite_code')
    .eq('owner_id', caller.id)
    .maybeSingle()
  if (!org) {
    return json({ error: 'not_an_org_owner' }, 403)
  }

  const origin = req.headers.get('origin') ?? undefined

  const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { invite_code: org.invite_code },
    redirectTo: origin ? `${origin}/?invited=1` : undefined,
  })

  if (inviteError) {
    const alreadyRegistered =
      inviteError.code === 'email_exists' ||
      ([400, 422].includes(inviteError.status ?? 0) &&
        /already (been )?registered|already exists/i.test(inviteError.message ?? ''))
    if (alreadyRegistered) {
      return json({ error: 'already_registered' }, 422)
    }
    console.error('invite-member: inviteUserByEmail failed', inviteError)
    return json({ error: 'invite_failed' }, 500)
  }

  return json({ ok: true })
})
