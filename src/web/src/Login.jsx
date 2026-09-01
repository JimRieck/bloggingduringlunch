import { useState } from 'react'
import './Login.css'
import { supabase } from './supabaseClient.js'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

function LoginForm({ onSwitch }) {
  const [values, setValues] = useState({ userId: '', password: '', remember: false })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const nextErrors = {}
    if (!values.userId.trim()) nextErrors.userId = 'Enter your email.'
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

function RegisterForm({ onSwitch }) {
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

function ForgotPasswordForm({ onSwitch }) {
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
          If an account exists for <strong>{email}</strong>, a reset link would be
          sent — this is a UI preview, so nothing was actually sent.
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

function Login({ onBack }) {
  const [view, setView] = useState('login')

  return (
    <div id="auth-screen">
      <div className="auth-card">
        {view === 'login' && <LoginForm onSwitch={setView} />}
        {view === 'register' && <RegisterForm onSwitch={setView} />}
        {view === 'forgot' && <ForgotPasswordForm onSwitch={setView} />}
      </div>
      <button type="button" className="link back-link" onClick={onBack}>
        &larr; Back to blog
      </button>
    </div>
  )
}

export default Login
