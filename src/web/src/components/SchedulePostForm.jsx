import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import {
  MAX_MESSAGE_LENGTH,
  MAX_VARIATIONS,
  RECURRENCE_OPTIONS,
  describeScheduleError,
  toLocalInputValue,
} from '../lib/socialPosting.js'
import { linkedinTextLength } from '../lib/linkedinTextFormat.js'
import { LinkedInMessageEditor } from './LinkedInMessageEditor.jsx'
import './SchedulePostForm.css'

// Next round 15 minutes -- a sensible default for "later today".
function defaultStart() {
  const d = new Date(Date.now() + 15 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0)
  return toLocalInputValue(d)
}

function newMessage() {
  return { id: crypto.randomUUID(), text: '' }
}

export function SchedulePostForm({ posts, connected, organizationId, userId, onCreated }) {
  const [postId, setPostId] = useState('')
  // {id, text}[], not a plain string[] -- each variation gets its own
  // LinkedInMessageEditor instance below, keyed by id rather than array
  // index, so removing one variation can't make React reuse another
  // variation's editor DOM node (and its uncontrolled Tiptap content)
  // for a different logical message.
  const [messages, setMessages] = useState(() => [newMessage()])
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [recurrence, setRecurrence] = useState('none')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function updateMessage(id, text) {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, text } : m)))
  }

  function removeMessage(id) {
    setMessages((current) => current.filter((m) => m.id !== id))
  }

  // mode: 'schedule' uses the chosen start time and repeat settings;
  // 'now' is a one-time post right away.
  async function submit(mode) {
    const cleaned = messages.map((m) => m.text.trim()).filter(Boolean)
    if (cleaned.length === 0) {
      setError('Write what you want to post.')
      return
    }
    // The editor has no hard input cap (unlike a plain <textarea
    // maxLength>), so this is the actual enforcement point client-side
    // -- prepare_scheduled_social_post's own check in the database is
    // still the real backstop.
    if (cleaned.some((m) => linkedinTextLength(m) > MAX_MESSAGE_LENGTH)) {
      setError(`One of your messages is over the ${MAX_MESSAGE_LENGTH}-character limit.`)
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
      setMessages([newMessage()])
      setNotice('Posted to LinkedIn.')
      return
    }

    setBusy(false)
    setMessages([newMessage()])
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
        {messages.map((m, index) => (
          <div className="schedule-message" key={m.id}>
            <LinkedInMessageEditor
              value={m.text}
              onChange={(text) => updateMessage(m.id, text)}
              organizationId={organizationId}
              userId={userId}
              ariaLabel={index === 0 ? 'Post text' : `Variation ${index + 1}`}
            />
            {messages.length > 1 && (
              <div className="schedule-message-meta">
                <button type="button" className="link" onClick={() => removeMessage(m.id)} disabled={busy}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
        {messages.length < MAX_VARIATIONS && (
          <button
            type="button"
            className="link"
            onClick={() => setMessages((current) => [...current, newMessage()])}
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
