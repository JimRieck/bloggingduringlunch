import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './SocialPosting.css'

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000

async function readFunctionError(data, invokeError) {
  let reason = data?.error
  if (!reason && invokeError?.context) {
    try {
      reason = (await invokeError.context.json())?.error
    } catch {
      // not JSON -- fall through to the generic message
    }
  }
  return reason
}

export function LinkedInConnection({ connection, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleConnect() {
    setError('')
    setBusy(true)
    const { data, error: invokeError } = await supabase.functions.invoke('linkedin-connect-start')
    if (invokeError || !data?.url) {
      setBusy(false)
      const reason = await readFunctionError(data, invokeError)
      setError(
        reason === 'not_configured'
          ? 'LinkedIn isn’t configured yet.'
          : 'Couldn’t start the LinkedIn connection. Try again.',
      )
      return
    }
    // Hand off to LinkedIn; it redirects back to /social when done.
    window.location.href = data.url
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect LinkedIn? Scheduled posts will stop until you reconnect.')) return
    setError('')
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('disconnect_linkedin')
    setBusy(false)
    if (rpcError) {
      setError('Couldn’t disconnect. Try again.')
      return
    }
    onChanged()
  }

  const expiresAt = connection ? new Date(connection.expires_at) : null
  const expired = expiresAt && expiresAt <= new Date()
  const expiringSoon = expiresAt && !expired && expiresAt - new Date() < EXPIRY_WARNING_MS

  return (
    <section className="social-card">
      <h3>LinkedIn</h3>
      {connection ? (
        <>
          <p className="social-connection-line">
            Connected as <strong>{connection.member_name || 'your LinkedIn account'}</strong>
          </p>
          <p className={`social-connection-expiry${expired || expiringSoon ? ' warn' : ''}`}>
            {expired
              ? 'This connection has expired.'
              : `Connection valid until ${expiresAt.toLocaleDateString()}${expiringSoon ? ' — reconnect soon.' : '.'}`}
          </p>
          <div className="social-card-actions">
            {(expired || expiringSoon) && (
              <button type="button" className="primary" onClick={handleConnect} disabled={busy}>
                Reconnect
              </button>
            )}
            <button type="button" className="secondary" onClick={handleDisconnect} disabled={busy}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="social-connection-line">Connect your LinkedIn account to schedule posts to your profile.</p>
          <div className="social-card-actions">
            <button type="button" className="primary" onClick={handleConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect LinkedIn'}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
