import { useState } from 'react'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import './auth.css'

export function SetNewPasswordForm({ onDone }) {
  const [values, setValues] = useState({ password: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [done, setDone] = useState(false)

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const nextErrors = {}
    if (!values.password) {
      nextErrors.password = 'Choose a new password.'
    } else if (values.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.'
    }
    if (values.confirmPassword !== values.password) {
      nextErrors.confirmPassword = 'Passwords don’t match.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setNotice('')
    const { error } = await supabase.auth.updateUser({ password: values.password })
    if (error) {
      setNotice(error.message)
    } else {
      setDone(true)
    }
  }

  return (
    <div id="auth-screen">
      <div className="auth-card">
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <h2>Set new password</h2>
          {done ? (
            <>
              <p className="auth-notice" role="status">
                Your password has been updated.
              </p>
              <button type="button" className="primary" onClick={onDone}>
                Continue
              </button>
            </>
          ) : (
            <>
              <p className="auth-hint">Choose a new password for your account.</p>
              <Field label="New password" error={errors.password}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={values.password}
                  onChange={(e) => update('password', e.target.value)}
                />
              </Field>
              <Field label="Confirm new password" error={errors.confirmPassword}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  onChange={(e) => update('confirmPassword', e.target.value)}
                />
              </Field>
              {notice && (
                <p className="auth-notice" role="status">
                  {notice}
                </p>
              )}
              <button type="submit" className="primary">
                Update password
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  )
}
