import { supabase } from '../lib/supabaseClient.js'
import { MfaCodeForm } from './MfaCodeForm.jsx'
import './auth.css'
import './Mfa.css'

// The second login step, after a correct password, for an account that
// already has an authenticator. Once the code is accepted, Supabase
// upgrades the session and App.jsx moves on by itself.
export function MfaChallenge() {
  async function verify(code) {
    const { data, error: listError } = await supabase.auth.mfa.listFactors()
    const factor = data?.totp?.[0]
    if (listError || !factor) return 'Couldn’t check your code. Reload the page and try again.'
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    return error ? 'That code didn’t match. Check the app and try the current code.' : null
  }

  return (
    <div id="auth-screen">
      <div className="auth-card mfa-card">
        <h2>Enter your code</h2>
        <p className="auth-hint">Open your authenticator app and enter the 6-digit code for Blogging During Lunch.</p>
        <MfaCodeForm submitLabel="Verify" onSubmit={verify} />
        <p className="mfa-help">Lost your phone? Ask a site admin to reset two-factor on your account.</p>
        <div className="auth-links">
          <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
