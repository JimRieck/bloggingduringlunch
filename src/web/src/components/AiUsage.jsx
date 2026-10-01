import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { aiFeatureLabel, isoDateDaysAgo } from '../lib/aiUsage.js'
import './MyStats.css'

// How often each AI feature is being used, and by whom, for the admin
// page. Every AI Edge Function records one row per request in
// ai_usage_events; both tables here come from RPCs that aggregate in
// the database (20261001100000), same as SiteStats.jsx's charts.
export function AiUsage() {
  const [range, setRange] = useState(() => ({ start: isoDateDaysAgo(29), end: isoDateDaysAgo(0) }))
  const [featureRows, setFeatureRows] = useState(null)
  const [userRows, setUserRows] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => isoDateDaysAgo(0), [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const args = { start_date: range.start, end_date: range.end }
      const [byFeature, byUser] = await Promise.all([
        supabase.rpc('ai_usage_by_feature', args),
        supabase.rpc('ai_usage_by_user', args),
      ])
      if (cancelled) return
      setError(byFeature.error || byUser.error ? 'Couldn’t load AI usage. Try again.' : '')
      setFeatureRows(byFeature.data ?? [])
      setUserRows(byUser.data ?? [])
    }

    load()
    return () => {
      cancelled = true
    }
  }, [range])

  function handleStartChange(e) {
    const value = e.target.value
    if (!value) return
    setRange((r) => (value > r.end ? { start: value, end: value } : { ...r, start: value }))
  }

  function handleEndChange(e) {
    const value = e.target.value
    if (!value) return
    setRange((r) => (value < r.start ? { start: value, end: value } : { ...r, end: value }))
  }

  const totalCalls = (featureRows ?? []).reduce((sum, r) => sum + r.calls, 0)
  const totalFailed = (featureRows ?? []).reduce((sum, r) => sum + r.failed, 0)

  return (
    <section id="ai-usage">
      <div className="my-stats-filters">
        <label className="my-stats-field">
          <span>Start date</span>
          <input type="date" value={range.start} max={range.end} onChange={handleStartChange} />
        </label>
        <label className="my-stats-field">
          <span>End date</span>
          <input type="date" value={range.end} min={range.start} max={today} onChange={handleEndChange} />
        </label>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {featureRows === null || userRows === null ? (
        <p className="directory-status">Loading…</p>
      ) : featureRows.length === 0 ? (
        <p className="directory-status">No AI requests in this date range.</p>
      ) : (
        <>
          <p className="my-stats-total">
            <strong>{totalCalls}</strong> AI request{totalCalls === 1 ? '' : 's'}
            {totalFailed > 0 && <> ({totalFailed} failed)</>}
          </p>

          <h3 className="admin-subheading">By feature</h3>
          <div className="directory-table-wrap">
            <table className="directory-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Requests</th>
                  <th>Failed</th>
                  <th>Users</th>
                </tr>
              </thead>
              <tbody>
                {featureRows.map((r) => (
                  <tr key={r.feature}>
                    <td>{aiFeatureLabel(r.feature)}</td>
                    <td>{r.calls}</td>
                    <td>{r.failed}</td>
                    <td>{r.users}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="admin-subheading">By user</h3>
          <div className="directory-table-wrap">
            <table className="directory-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Requests</th>
                  <th>Failed</th>
                  <th>Last used</th>
                </tr>
              </thead>
              <tbody>
                {userRows.map((r) => (
                  <tr key={r.user_id}>
                    <td>
                      <div className="directory-name">{r.display_name || '—'}</div>
                      <div className="directory-email">{r.email}</div>
                    </td>
                    <td>{r.calls}</td>
                    <td>{r.failed}</td>
                    <td>{new Date(r.last_used_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
