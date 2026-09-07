import { useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { Field } from './Field.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { EMAIL_PATTERN } from '../lib/validation.js'
import './InviteMemberModal.css'

export function InviteMemberModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Enter an email address.')
      return
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setSending(true)

    const { error: invokeError } = await supabase.functions.invoke('invite-member', {
      body: { email: email.trim() },
    })

    setSending(false)

    if (invokeError) {
      if (invokeError instanceof FunctionsHttpError) {
        const body = await invokeError.context.json().catch(() => null)
        if (body?.error === 'already_registered') {
          setError('This person already has an account — share your invite code with them instead.')
          return
        }
      }
      setError('Something went wrong sending the invite. Try again.')
      return
    }

    setSent(true)
  }

  return (
    <div className="invite-member-overlay" onClick={onClose}>
      <div className="invite-member-modal" onClick={(e) => e.stopPropagation()}>
        <div className="invite-member-header">
          <h3>Invite by email</h3>
          <button type="button" className="invite-member-close" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        </div>

        {sent ? (
          <>
            <p className="auth-notice" role="status">
              Invite sent to <strong>{email}</strong>.
            </p>
            <button
              type="button"
              className="link"
              onClick={() => {
                setEmail('')
                setSent(false)
              }}
            >
              Send another
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <Field label="Email" error={error}>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
              />
            </Field>
            <button type="submit" className="primary" disabled={sending}>
              {sending ? 'Sending…' : 'Send invite'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
