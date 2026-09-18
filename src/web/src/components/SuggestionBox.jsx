import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { SUGGESTION_STATUS_LABELS } from '../lib/suggestionStatus.js'
import './SuggestionBox.css'

export function SuggestionBox({ session }) {
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [suggestions, setSuggestions] = useState(null)

  useEffect(() => {
    supabase
      .from('suggestions')
      .select('id, content, status, created_at')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setSuggestions(data ?? []))
  }, [session.user.id])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!content.trim()) {
      setError('Write a suggestion first.')
      return
    }
    setError('')
    setNotice('')
    setSubmitting(true)

    const { data, error: invokeError } = await supabase.functions.invoke('submit-suggestion', {
      body: { content: content.trim() },
    })

    setSubmitting(false)
    if (invokeError || !data?.suggestion) {
      setError("Couldn't submit your suggestion. Try again.")
      return
    }

    setSuggestions((current) => [data.suggestion, ...(current ?? [])])
    setContent('')
    setNotice("Thanks! We'll email you when there's an update.")
  }

  return (
    <div id="suggestion-box">
      <h2>Suggestions</h2>
      <p className="suggestion-box-intro">
        Have an idea for the site? Let us know below &mdash; we read every one, and you&rsquo;ll get an email
        when we&rsquo;ve looked at it.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What should we build or fix?"
          rows={4}
          disabled={submitting}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit suggestion'}
        </button>
      </form>
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}

      <h3>Your suggestions</h3>
      {suggestions === null ? (
        <p className="suggestion-box-status">Loading…</p>
      ) : suggestions.length === 0 ? (
        <p className="suggestion-box-status">You haven&rsquo;t submitted any suggestions yet.</p>
      ) : (
        <ul className="suggestion-list">
          {suggestions.map((s) => (
            <li key={s.id} className="suggestion-row">
              <p className="suggestion-content">{s.content}</p>
              <div className="suggestion-meta">
                <span className={`status-badge status-${s.status}`}>{SUGGESTION_STATUS_LABELS[s.status]}</span>
                <span className="suggestion-date">{new Date(s.created_at).toLocaleDateString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
