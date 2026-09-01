import { useState } from 'react'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { EMAIL_PATTERN } from '../lib/validation.js'
import './auth.css'

export function RegisterForm({ onSwitch }) {
  const [values, setValues] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const nextErrors = {}
    if (!values.username.trim()) nextErrors.username = 'Choose a user ID.'
    if (!values.email.trim()) {
      nextErrors.email = 'Enter your email.'
    } else if (!EMAIL_PATTERN.test(values.email)) {
      nextErrors.email = 'Enter a valid email address.'
    }
    if (!values.password) {
      nextErrors.password = 'Choose a password.'
    } else if (values.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters.'
    }
    if (values.confirmPassword !== values.password) {
      nextErrors.confirmPassword = 'Passwords don’t match.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setNotice('')
    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: { data: { username: values.username } },
    })
    if (error) {
      setNotice(error.message)
    } else if (data.user && !data.session) {
      setNotice('Check your email to confirm your account before logging in.')
    } else {
      setNotice('Account created.')
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h2>Create account</h2>
      <Field label="User ID" error={errors.username}>
        <input
          type="text"
          autoComplete="username"
          value={values.username}
          onChange={(e) => update('username', e.target.value)}
        />
      </Field>
      <Field label="Email" error={errors.email}>
        <input
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
        />
      </Field>
      <Field label="Password" error={errors.password}>
        <input
          type="password"
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => update('password', e.target.value)}
        />
      </Field>
      <Field label="Confirm password" error={errors.confirmPassword}>
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
        Create account
      </button>
      <div className="auth-links">
        <button type="button" className="link" onClick={() => onSwitch('login')}>
          Already have an account? Log in
        </button>
      </div>
    </form>
  )
}
