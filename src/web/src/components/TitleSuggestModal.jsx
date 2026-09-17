import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Modal } from './Modal.jsx'
import './TitleSuggestModal.css'

// Fetches on mount (the moment the modal opens), rather than PostForm
// pre-fetching and handing down a result -- keeps the async suggestion
// work owned by the thing that displays it.
export function TitleSuggestModal({ content, onSelect, onClose }) {
  const [titles, setTitles] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data, error: suggestError } = await supabase.functions.invoke('suggest-post-titles', {
        body: { content },
      })
      if (cancelled) return

      if (suggestError || data?.error) {
        // supabase-js doesn't parse a non-2xx function response body
        // into `data` -- the specific error code only shows up in
        // `error.context`, the raw Response.
        let reason = data?.error
        if (!reason && suggestError?.context) {
          try {
            reason = (await suggestError.context.json())?.error
          } catch {
            // context wasn't JSON, or already consumed -- fall through
          }
        }
        if (cancelled) return
        setError(
          reason === 'not_configured'
            ? 'Title suggestions aren’t configured yet.'
            : 'Couldn’t generate suggestions. Try again.',
        )
        return
      }
      setTitles(data.titles ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [content])

  return (
    <Modal title="Suggested titles" onClose={onClose}>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : titles === null ? (
        <p className="title-suggest-status">Thinking…</p>
      ) : (
        <ul className="title-suggest-list">
          {titles.map((t) => (
            <li key={t}>
              <button type="button" onClick={() => onSelect(t)}>
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
