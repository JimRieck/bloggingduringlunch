import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { formatDayLabel, formatSiteDateTime, siteDateDaysAgo } from '../lib/siteTime.js'
import { classifySource, SOURCE_TYPES } from '../lib/trafficSources.js'
import { formatVisitLocation } from '../lib/siteVisit.js'
import { ViewsLineChart } from './ViewsLineChart.jsx'
import './MyStats.css'
import './AdminPanel.css'
import './HomeVisits.css'

// The table shows at most this many visits (newest first); the total
// above it always counts them all.
const MAX_ROWS = 500

// /admin/visits: signed-out visits to the public home page
// (site_visits, 20261124100000), recorded by api/visit.js. A date range,
// hits per day as a line chart, then each visit: when, roughly where
// from, and which site or link sent them.
export function HomeVisits() {
  const [range, setRange] = useState(() => ({ start: siteDateDaysAgo(29), end: siteDateDaysAgo(0) }))
  const [byDay, setByDay] = useState(null)
  const [visits, setVisits] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => siteDateDaysAgo(0), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const args = { start_date: range.start, end_date: range.end, path_filter: '/' }
      const [days, list] = await Promise.all([
        supabase.rpc('site_visits_by_day', args),
        supabase.rpc('site_visit_list', { ...args, max_rows: MAX_ROWS }),
      ])
      if (cancelled) return
      setError(days.error || list.error ? 'Couldn’t load home page visits. Try again.' : '')
      setByDay((days.data ?? []).map((d) => ({ date: d.day, views: d.visits })))
      setVisits(list.data ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [range])

  const total = (byDay ?? []).reduce((sum, d) => sum + d.views, 0)

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

  return (
    <div id="home-visits">
      <h1>Home page visits</h1>
      <p className="home-visits-intro">
        Every time someone who isn&rsquo;t signed in opens bloggingduringlunch.com. Dates and times are Eastern; locations
        are approximate, from the visitor&rsquo;s internet connection.
      </p>

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

      {byDay === null || visits === null ? (
        <p className="directory-status">Loading…</p>
      ) : (
        <>
          <p className="my-stats-total">
            <strong>{total}</strong> visit{total === 1 ? '' : 's'} from {formatDayLabel(range.start)} to{' '}
            {formatDayLabel(range.end)}
          </p>

          <h2 className="admin-subheading">Hits per day</h2>
          <ViewsLineChart data={byDay} formatLabel={formatDayLabel} unit="hit" ariaLabel="Home page hits per day" />

          <h2 className="admin-subheading">Visits</h2>
          {visits.length === 0 ? (
            <p className="post-views-note">No visits in this range.</p>
          ) : (
            <>
              {total > visits.length && (
                <p className="post-views-hint">
                  Showing the latest {visits.length} of {total}. Narrow the dates to see earlier ones.
                </p>
              )}
              <table className="post-views-table home-visits-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Location</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visits.map((v) => {
                    const source = classifySource({ referrerHost: v.referrer_host, utmSource: v.utm_source })
                    const detail = []
                    if (SOURCE_TYPES[source.type] !== source.name) detail.push(SOURCE_TYPES[source.type])
                    if (v.utm_source) detail.push(`utm_source=${v.utm_source}`)
                    else if (v.referrer_host && v.referrer_host.replace(/^www\./, '') !== source.name) {
                      detail.push(v.referrer_host)
                    }
                    return (
                      <tr key={v.id}>
                        <td>
                          <span className="post-views-name">{formatSiteDateTime(v.visited_at)}</span>
                          <span className="post-views-detail">Page: {v.path}</span>
                        </td>
                        <td>{formatVisitLocation(v)}</td>
                        <td>
                          <span className="post-views-name" title={v.referrer ?? undefined}>
                            {source.name}
                          </span>
                          {detail.length > 0 && <span className="post-views-detail">{detail.join(' · ')}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  )
}
