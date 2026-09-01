import { useState } from 'react'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { EMAIL_PATTERN } from '../lib/validation.js'
import './auth.css'

export function ForgotPasswordForm({ onSwitch }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter your email.')
      setSent(false)
      return
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.')
      setSent(false)
      return
    }
    setError('')
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setSent(true)
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h2>Reset password</h2>
      {sent ? (
        <p className="auth-notice" role="status">
          If an account exists for <strong>{email}</strong>, a reset link has been
          sent.
        </p>
      ) : (
        <>
          <p className="auth-hint">
            Enter your email and we&rsquo;ll send you a link to reset your password.
          </p>
          <Field label="Email" error={error}>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <button type="submit" className="primary">
            Send reset link
          </button>
        </>
      )}
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onSwitch('login')}>
          Back to log in
        </button>
      </div>
    </form>
  )
}
