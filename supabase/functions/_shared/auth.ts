import { createClient } from 'jsr:@supabase/supabase-js@2'

// The `aal` claim of an access token that getUser() has already
// verified -- reading the payload without re-checking the signature is
// only safe after that.
function assuranceLevel(authHeader: string): string | undefined {
  try {
    const payload = authHeader.replace(/^Bearer\s+/i, '').split('.')[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))?.aal
  } catch {
    return undefined
  }
}

// Verifies the request carries a real logged-in user's own JWT, via a
// forwarded Authorization header, and returns that user -- or null. A
// function that needs a role check (site admin, org owner) still does
// that itself afterward; this only answers "who is calling".
//
// Two-factor authentication is required for every account
// (20261006100000_require_mfa.sql), so a token from a login that hasn't
// finished the authenticator-code step (aal1) counts as not logged in.
// Most functions here use a service-role client after this check, which
// the database's own MFA check can't see, so this is the gate for them.
export async function getCaller(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
  } = await callerClient.auth.getUser()
  if (!user || assuranceLevel(authHeader) !== 'aal2') return null
  return user
}
