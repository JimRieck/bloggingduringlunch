import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import {
  MAX_MESSAGE_LENGTH,
  MAX_VARIATIONS,
  RECURRENCE_OPTIONS,
  describeScheduleError,
  toLocalInputValue,
} from '../lib/socialPosting.js'
import './SchedulePostForm.css'

// Next round 15 minutes -- a sensible default for "later today".
function defaultStart() {
  const d = new Date(Date.now() + 15 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return toLocalInputValue(d)
}

export function SchedulePostForm({ posts, connected, onCreated }) {
  const [postId, setPostId] = useState('')
  const [messages, setMessages] = useState([''])
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [recurrence, setRecurrence] = useState('none')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function updateMessage(index, value) {
    setMessages((current) => current.map((m, i) => (i === index ? value : m)))
  }

  function removeMessage(index) {
    setMessages((current) => current.filter((_, i) => i !== index))
  }

  // mode: 'schedule' uses the chosen start time and repeat settings;
  // 'now' is a one-time post right away.
  async function submit(mode) {
    const cleaned = messages.map((m) => m.trim()).filter(Boolean)
    if (cleaned.length === 0) {
      setError('Write what you want to post.')
      return
    }
    if (mode === 'schedule' && !startsAt) {
      setError('Pick when to post.')
      return
    }
    const repeating = mode === 'schedule' && recurrence !== 'none'
    const first = mode === 'now' ? new Date() : new Date(startsAt)
    if (repeating && endsAt && new Date(endsAt) <= first) {
      setError('The end date has to be after the first post.')
      return
    }

    setError('')
    setNotice('')
    setBusy(true)

    const { data: created, error: insertError } = await supabase
      .from('scheduled_social_posts')
      .insert({
        post_id: postId || null,
        messages: cleaned,
        first_run_at: first.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recurrence: repeating ? recurrence : 'none',
        ends_at: repeating && endsAt ? new Date(endsAt).toISOString() : null,
      })
      .select('id')
      .single()
    if (insertError) {
      setBusy(false)
      setError(
        insertError.message.includes('too many active')
          ? 'You have the maximum of 20 active scheduled posts. Delete or wait for one to finish.'
          : 'Couldn’t save that. Try again.',
      )
      return
    }

    if (mode === 'now') {
      const { data: result, error: invokeError } = await supabase.functions.invoke('linkedin-post-now', {
        body: { scheduleId: created.id },
      })
      setBusy(false)
      onCreated()
      if (invokeError || !result?.ok) {
        setError(describeScheduleError(result?.error) || 'Couldn’t post to LinkedIn. See the list below for details.')
        return
      }
      setMessages([''])
      setNotice('Posted to LinkedIn.')
      return
    }

    setBusy(false)
    setMessages([''])
    setNotice('Scheduled.')
    onCreated()
  }

  return (
    <section className="social-card schedule-form">
      <h3>New post</h3>

      <label className="field">
        <span>Link a blog post (optional)</span>
        <select value={postId} onChange={(e) => setPostId(e.target.value)} disabled={busy}>
          <option value="">No link — text only</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>

      <div className="schedule-messages">
        <span className="schedule-label">What to say</span>
        {messages.map((message, index) => (
          <div className="schedule-message" key={index}>
            <textarea
              value={message}
              onChange={(e) => updateMessage(index, e.target.value)}
              placeholder={index === 0 ? 'Write your LinkedIn post…' : `Variation ${index + 1}`}
              maxLength={MAX_MESSAGE_LENGTH}
              rows={4}
              disabled={busy}
              aria-label={index === 0 ? 'Post text' : `Variation ${index + 1}`}
            />
            <div className="schedule-message-meta">
              <span>
                {message.length}/{MAX_MESSAGE_LENGTH}
              </span>
              {messages.length > 1 && (
                <button type="button" className="link" onClick={() => removeMessage(index)} disabled={busy}>
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
        {messages.length < MAX_VARIATIONS && (
          <button
            type="button"
            className="link"
            onClick={() => setMessages((current) => [...current, ''])}
            disabled={busy}
          >
            + Add a variation
          </button>
        )}
        <p className="schedule-hint">
          LinkedIn tends to reject identical repeat posts. For a repeating post, add variations and they&rsquo;ll
          take turns.
        </p>
      </div>

      <div className="schedule-when">
        <label className="field">
          <span>Post at</span>
          <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span>Repeat</span>
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} disabled={busy}>
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {recurrence !== 'none' && (
          <label className="field">
            <span>Stop repeating after (optional)</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} disabled={busy} />
          </label>
        )}
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      {!connected && <p className="schedule-hint">Connect LinkedIn above to schedule posts.</p>}

      <div className="schedule-actions">
        <button type="button" className="secondary" onClick={() => submit('now')} disabled={busy || !connected}>
          Post now
        </button>
        <button type="button" className="primary" onClick={() => submit('schedule')} disabled={busy || !connected}>
          {busy ? 'Working…' : 'Schedule'}
        </button>
      </div>
    </section>
  )
}
