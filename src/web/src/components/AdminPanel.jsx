import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { SUGGESTION_STATUSES, SUGGESTION_STATUS_LABELS } from '../lib/suggestionStatus.js'
import { SiteStats } from './SiteStats.jsx'
import { Accordion } from './Accordion.jsx'
import './UserDirectory.css'
import './AdminPanel.css'

// Human-readable labels for feature_flags.key -- one row per AI feature,
// same six keys the client checks via useFeatureFlags() and every AI
// Edge Function checks server-side (src/web/src/lib/featureFlags.js,
// supabase/functions/_shared/featureFlags.ts).
const FEATURE_FLAG_LABELS = {
  ai_tag_generation: 'AI tag generation',
  ai_category_generation: 'AI category generation',
  ai_title_generation: 'AI title generation',
  ai_body_generation: 'AI post draft generation',
  ai_image_generation: 'AI image generation',
  ai_bulk_auto_tag: 'Bulk auto-tag (Auto-tag posts menu)',
}

export function AdminPanel({ session }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState(null)
  const [flags, setFlags] = useState(null)
  const [flagsError, setFlagsError] = useState('')
  const [pendingFlagKey, setPendingFlagKey] = useState(null)
  const [suggestions, setSuggestions] = useState(null)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [pendingSuggestionId, setPendingSuggestionId] = useState(null)

  function load() {
    supabase
      .from('profiles')
      .select('id, email, display_name, user_type, disabled')
      .order('email')
      .then(({ data }) => setUsers(data ?? []))
  }

  useEffect(() => {
    load()

    // Two-step fetch, not an embed -- same reasoning as BulkAutoTag.jsx's
    // loadCategoriesAndTags: suggestions.user_id -> profiles is a plain
    // foreign key with no FK-based embed relationship set up, and
    // profiles' own RLS ("Site admins can view all profiles") is
    // independent of suggestions' RLS anyway.
    async function loadSuggestions() {
      const { data: rows } = await supabase
        .from('suggestions')
        .select('id, user_id, content, status, created_at')
        .order('created_at', { ascending: false })
      const suggestionRows = rows ?? []

      const userIds = [...new Set(suggestionRows.map((s) => s.user_id))]
      const { data: profileRows } = userIds.length
        ? await supabase.from('profiles').select('id, email, display_name').in('id', userIds)
        : { data: [] }
      const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]))

      setSuggestions(suggestionRows.map((s) => ({ ...s, submitter: profileById.get(s.user_id) })))
    }
    loadSuggestions()

    supabase
      .from('feature_flags')
      .select('key, enabled')
      .order('key')
      .then(({ data }) => setFlags(data ?? []))
  }, [])

  // Direct table update, not an Edge Function -- the "Site admins can
  // update feature flags" RLS policy (is_site_admin()) is already the
  // only check this needs, same as any other RLS-protected write in
  // this app.
  async function toggleFlag(flag) {
    setFlagsError('')
    setPendingFlagKey(flag.key)
    const { error: updateError } = await supabase
      .from('feature_flags')
      .update({ enabled: !flag.enabled, updated_at: new Date().toISOString() })
      .eq('key', flag.key)
    setPendingFlagKey(null)
    if (updateError) {
      setFlagsError(`Couldn't update ${FEATURE_FLAG_LABELS[flag.key] ?? flag.key}. Try again.`)
      return
    }
    setFlags((current) => current.map((f) => (f.key === flag.key ? { ...f, enabled: !f.enabled } : f)))
  }

  // Through an Edge Function, not a direct table update like toggleFlag
  // -- this one has a required side effect (emailing the submitter) that
  // has to run server-side, not something the client can be trusted to
  // do reliably or that should expose the Resend API key to the browser.
  async function handleStatusChange(suggestion, status) {
    setSuggestionsError('')
    setPendingSuggestionId(suggestion.id)
    const { data, error: invokeError } = await supabase.functions.invoke('update-suggestion-status', {
      body: { suggestionId: suggestion.id, status },
    })
    setPendingSuggestionId(null)
    if (invokeError || !data?.suggestion) {
      setSuggestionsError("Couldn't update that suggestion. Try again.")
      return
    }
    setSuggestions((current) => current.map((s) => (s.id === suggestion.id ? { ...s, status } : s)))
  }

  async function toggleDisabled(user) {
    setError('')
    setPendingId(user.id)
    const { error: invokeError } = await supabase.functions.invoke('admin-set-account-status', {
      body: { userId: user.id, disabled: !user.disabled },
    })
    setPendingId(null)
    if (invokeError) {
      setError(`Couldn't update ${user.email}. Try again.`)
      return
    }
    setUsers((current) =>
      current.map((u) => (u.id === user.id ? { ...u, disabled: !u.disabled } : u)),
    )
  }

  if (users === null) {
    return (
      <div id="directory" className="directory-status">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div id="directory">
      <h1>Site admin</h1>

      <Accordion title="Site traffic">
        <SiteStats />
      </Accordion>

      <Accordion title="Feature flags">
        {flagsError && (
          <p className="field-error" role="alert">
            {flagsError}
          </p>
        )}
        <div className="directory-table-wrap">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {(flags ?? []).map((flag) => (
                <tr key={flag.key}>
                  <td>{FEATURE_FLAG_LABELS[flag.key] ?? flag.key}</td>
                  <td>
                    <label className="flag-toggle">
                      <input
                        type="checkbox"
                        checked={flag.enabled}
                        disabled={pendingFlagKey === flag.key}
                        onChange={() => toggleFlag(flag)}
                        aria-label={`${flag.enabled ? 'Disable' : 'Enable'} ${FEATURE_FLAG_LABELS[flag.key] ?? flag.key}`}
                      />
                      <span className="flag-toggle-track" aria-hidden="true" />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Accordion>

      <Accordion title="Suggestions">
        {suggestionsError && (
          <p className="field-error" role="alert">
            {suggestionsError}
          </p>
        )}
        {suggestions === null ? (
          <p className="directory-status">Loading…</p>
        ) : suggestions.length === 0 ? (
          <p className="directory-status">No suggestions yet.</p>
        ) : (
          <div className="directory-table-wrap">
            <table className="directory-table">
              <thead>
                <tr>
                  <th>Submitted by</th>
                  <th>When</th>
                  <th>Suggestion</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="directory-name">{s.submitter?.display_name || '—'}</div>
                      <div className="directory-email">{s.submitter?.email}</div>
                    </td>
                    <td>{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="suggestion-cell">{s.content}</td>
                    <td>
                      <select
                        value={s.status}
                        disabled={pendingSuggestionId === s.id}
                        onChange={(e) => handleStatusChange(s, e.target.value)}
                        aria-label={`Status for suggestion from ${s.submitter?.email ?? 'unknown'}`}
                      >
                        {SUGGESTION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {SUGGESTION_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Accordion>

      <Accordion title="Users">
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="directory-table-wrap">
          <table className="directory-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Type</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="directory-name">{user.display_name || '—'}</div>
                    <div className="directory-email">{user.email}</div>
                  </td>
                  <td>{user.user_type}</td>
                  <td>
                    <span className={`admin-status-badge ${user.disabled ? 'disabled' : 'active'}`}>
                      {user.disabled ? 'disabled' : 'active'}
                    </span>
                  </td>
                  <td>
                    {user.id === session.user.id ? (
                      <span className="admin-self-note">this is you</span>
                    ) : (
                      <button
                        type="button"
                        className="link"
                        onClick={() => toggleDisabled(user)}
                        disabled={pendingId === user.id}
                      >
                        {pendingId === user.id ? 'Working…' : user.disabled ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Accordion>
    </div>
  )
}
