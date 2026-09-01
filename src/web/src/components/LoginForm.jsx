import { useState } from 'react'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { EMAIL_PATTERN } from '../lib/validation.js'
import './auth.css'

export function LoginForm({ onSwitch }) {
  const [values, setValues] = useState({ userId: '', password: '', remember: false })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const nextErrors = {}
    if (!values.userId.trim()) {
      nextErrors.userId = 'Enter your email.'
    } else if (!EMAIL_PATTERN.test(values.userId)) {
      nextErrors.userId = 'Enter a valid email address.'
    }
    if (!values.password) nextErrors.password = 'Enter your password.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setNotice('')
    const { error } = await supabase.auth.signInWithPassword({
      email: values.userId,
      password: values.password,
    })
    setNotice(error ? error.message : 'Logged in.')
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h2>Log in</h2>
      <Field label="Email" error={errors.userId}>
        <input
          type="email"
          autoComplete="email"
          value={values.userId}
          onChange={(e) => update('userId', e.target.value)}
        />
      </Field>
      <Field label="Password" error={errors.password}>
        <input
          type="password"
          autoComplete="current-password"
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
        />
      </Field>
      <label className="remember">
        <input
          type="checkbox"
          checked={values.remember}
          onChange={(e) => update('remember', e.target.checked)}
        />
        <span>Remember me</span>
      </label>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      <button type="submit" className="primary">
        Log in
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onSwitch('forgot')}>
          Forgot password?
        </button>
        <button type="button" className="link" onClick={() => onSwitch('register')}>
          Need an account? Register
        </button>
      </div>
    </form>
  )
}
