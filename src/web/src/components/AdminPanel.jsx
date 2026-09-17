import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { SiteStats } from './SiteStats.jsx'
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

  function load() {
    supabase
      .from('profiles')
      .select('id, email, display_name, user_type, disabled')
      .order('email')
      .then(({ data }) => setUsers(data ?? []))
  }

  useEffect(() => {
    load()
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
      <SiteStats />

      <h2>Feature flags</h2>
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
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(flags ?? []).map((flag) => (
              <tr key={flag.key}>
                <td>{FEATURE_FLAG_LABELS[flag.key] ?? flag.key}</td>
                <td>
                  <span className={`admin-status-badge ${flag.enabled ? 'active' : 'disabled'}`}>
                    {flag.enabled ? 'on' : 'off'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="link"
                    onClick={() => toggleFlag(flag)}
                    disabled={pendingFlagKey === flag.key}
                  >
                    {pendingFlagKey === flag.key ? 'Working…' : flag.enabled ? 'Turn off' : 'Turn on'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Users</h2>
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
    </div>
  )
}
