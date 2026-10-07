import { useState } from 'react'
import { Field } from './Field.jsx'
import './auth.css'

// The "enter the 6-digit code" field + submit button, shared by MfaSetup
// (confirming a newly added authenticator) and MfaChallenge (logging
// in). `onSubmit(code)` resolves to an error message, or null on success.
export function MfaCodeForm({ submitLabel, onSubmit }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setError('')
    setBusy(true)
    const message = await onSubmit(code)
    setBusy(false)
    if (message) {
      setError(message)
      setCode('')
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Field label="6-digit code" error={error}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
      </Field>
      <button type="submit" className="primary" disabled={busy}>
        {busy ? 'Checking…' : submitLabel}
      </button>
    </form>
  )
}
