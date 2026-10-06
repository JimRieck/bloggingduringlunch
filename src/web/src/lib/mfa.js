// Two-factor authentication is required for every account (see
// supabase/migrations/20261006100000_require_mfa.sql). Given the current
// session, returns which step the user still has to complete before the
// app will work for them:
//   null        -- logged out, or fully logged in (password + code)
//   'setup'     -- logged in with a password, no authenticator set up yet
//   'challenge' -- logged in with a password, code not entered yet
// Read straight from the session (the access token's `aal` claim and the
// user's factors), the same data supabase.auth.mfa.
// getAuthenticatorAssuranceLevel() uses, but synchronously -- so the app
// never renders a frame of its normal screens, firing requests the
// database will refuse, before this is known.
export function mfaStep(session) {
  if (!session) return null
  if (tokenClaims(session.access_token)?.aal === 'aal2') return null
  const hasAuthenticator = (session.user?.factors ?? []).some(
    (f) => f.factor_type === 'totp' && f.status === 'verified',
  )
  return hasAuthenticator ? 'challenge' : 'setup'
}

function tokenClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
  } catch {
    return null
  }
}

// "JBSWY3DPEHPK3PXP" -> "JBSW Y3DP EHPK 3PXP", easier to type by hand
// into an authenticator app that can't scan the QR code.
export function formatSecret(secret) {
  return (secret ?? '').match(/.{1,4}/g)?.join(' ') ?? ''
}
