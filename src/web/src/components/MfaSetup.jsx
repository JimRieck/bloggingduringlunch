import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatSecret } from '../lib/mfa.js'
import { MfaCodeForm } from './MfaCodeForm.jsx'
import './auth.css'
import './Mfa.css'

// One-time setup, shown to anyone logged in with a password who hasn't
// added an authenticator yet (required for every account). Once the
// first code is accepted, Supabase upgrades the session and App.jsx
// moves on by itself -- nothing to call back.
export function MfaSetup() {
  const [factor, setFactor] = useState(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function start() {
      // A previous visit may have left a half-finished setup behind --
      // clear it so this one gets a fresh QR code.
      const { data: existing } = await supabase.auth.mfa.listFactors()
      for (const f of existing?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      // Supabase rejects two unconfirmed authenticators with the same
      // name, and this can briefly run twice at once (React's dev-mode
      // double mount, two tabs) -- a unique name keeps them apart. The
      // name never appears in the authenticator app itself.
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${crypto.randomUUID().slice(0, 8)}`,
      })
      if (cancelled) {
        if (data) await supabase.auth.mfa.unenroll({ factorId: data.id })
        return
      }
      if (error) {
        setLoadError('Couldn’t start two-factor setup. Reload the page to try again.')
        return
      }
      setFactor({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri })
    }
    start()
    return () => {
      cancelled = true
    }
  }, [])

  async function verify(code) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
    return error ? 'That code didn’t match. Check the app and try the current code.' : null
  }

  return (
    <div id="auth-screen">
      <div className="auth-card mfa-card">
        <h2>Set up two-factor authentication</h2>
        <p className="auth-hint">
          Every Blogging During Lunch account needs a second step at login. Scan this code with an authenticator
          app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then enter the 6-digit code it
          shows.
        </p>
        {loadError ? (
          <p className="auth-notice" role="alert">
            {loadError}
          </p>
        ) : !factor ? (
          <p className="auth-hint">Loading…</p>
        ) : (
          <>
            <img className="mfa-qr" src={factor.qrCode} alt="QR code to scan with your authenticator app" />
            {/* Setting up on the same phone that has the authenticator
                app means there's no second screen to scan from; most
                authenticator apps open otpauth:// links directly. */}
            <a className="mfa-app-link" href={factor.uri}>
              On this phone? Add it to your authenticator app
            </a>
            <p className="mfa-secret-label">Can&rsquo;t scan it? Enter this key in the app instead:</p>
            <code className="mfa-secret">{formatSecret(factor.secret)}</code>
            <MfaCodeForm submitLabel="Turn on two-factor" onSubmit={verify} />
          </>
        )}
        <div className="auth-links">
          <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
