import { useState } from 'react'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { EMAIL_PATTERN } from '../lib/validation.js'
import './auth.css'

export function RegisterForm({ onSwitch }) {
  const [values, setValues] = useState({
    accountType: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: '',
    newOrganizationName: '',
  })
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')

  function update(field, value) {
    setValues((v) => ({ ...v, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const isAuthor = values.accountType === 'author'
    const inviteCode = values.inviteCode.trim()
    const nextErrors = {}
    if (!values.accountType) nextErrors.accountType = 'Choose an account type.'
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
    if (isAuthor && !inviteCode && !values.newOrganizationName.trim()) {
      nextErrors.newOrganizationName = 'Enter an invite code or name your organization.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setNotice('')

    let invitedOrgName = null
    if (isAuthor && inviteCode) {
      const { data: lookup, error: lookupError } = await supabase.rpc('lookup_invite_code', {
        code: inviteCode,
      })
      if (lookupError || !lookup || lookup.length === 0) {
        setErrors({ inviteCode: 'That invite code isn’t valid.' })
        return
      }
      invitedOrgName = lookup[0].organization_name
    }

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: {
          username: values.username,
          user_type: values.accountType,
          invite_code: isAuthor && inviteCode ? inviteCode : null,
          new_organization_name: isAuthor && !inviteCode ? values.newOrganizationName : null,
        },
      },
    })
    if (error) {
      setNotice(error.message)
      return
    }

    if (data.user && !data.session) {
      setNotice('Check your email to confirm your account before logging in.')
    } else if (invitedOrgName) {
      setNotice(`Account created — you’ve joined ${invitedOrgName}.`)
    } else {
      // Signing up logs the user straight in, which navigates away
      // from this form before there's time to show more detail here
      // (e.g. a newly created org's invite code) -- that's shown
      // persistently in the logged-in footer instead (App.jsx).
      setNotice('Account created.')
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <h2>Create account</h2>
      <fieldset className="account-type">
        <legend>What type of user are you?</legend>
        <label>
          <input
            type="radio"
            name="accountType"
            value="reader"
            checked={values.accountType === 'reader'}
            onChange={(e) => update('accountType', e.target.value)}
          />
          Reader — read and follow blogs
        </label>
        <label>
          <input
            type="radio"
            name="accountType"
            value="author"
            checked={values.accountType === 'author'}
            onChange={(e) => update('accountType', e.target.value)}
          />
          Author — write your own blog
        </label>
        {errors.accountType && (
          <span className="field-error" role="alert">
            {errors.accountType}
          </span>
        )}
      </fieldset>
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
      {values.accountType === 'author' && (
        <>
          <Field label="Invite code" error={errors.inviteCode}>
            <input
              type="text"
              placeholder="Have a code from an existing blog?"
              value={values.inviteCode}
              onChange={(e) => update('inviteCode', e.target.value)}
            />
          </Field>
          <Field label="Organization name" error={errors.newOrganizationName}>
            <input
              type="text"
              placeholder="Leave blank if using an invite code above"
              value={values.newOrganizationName}
              onChange={(e) => update('newOrganizationName', e.target.value)}
              disabled={!!values.inviteCode.trim()}
            />
          </Field>
        </>
      )}
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
