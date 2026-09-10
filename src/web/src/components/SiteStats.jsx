import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { BarChart } from './BarChart.jsx'
import './MyStats.css'
import './SiteStats.css'

function isoDateString(date) {
  return date.toISOString().slice(0, 10)
}

function defaultRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { start: isoDateString(start), end: isoDateString(end) }
}

// Every date here is a UTC calendar date (the range boundaries, the
// `day` column site_views_by_day returns) -- this display label has
// to stay in UTC too, or it silently shows the wrong day for anyone
// not on UTC (see MyStats.jsx, where this exact thing bit the line
// chart).
function formatDay(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Site-wide traffic for the admin page: a user-picked date range,
// defaulting to the past 7 days. A range shows total hits per day
// across every org; picking the same start and end day instead
// breaks that one day's hits down by author, since "per day" would
// be a single, not-very-useful bar.
//
// Both modes call a Postgres RPC (site_views_by_day / 20260910125019)
// that groups and sums in the database, rather than fetching raw
// post_views rows and summing them in the browser -- the previous
// approach didn't scale past PostgREST's 1,000-row default response
// cap (a busy range would silently undercount, not error) and shipped
// far more data than the chart needed.
export function SiteStats() {
  const [range, setRange] = useState(defaultRange)
  const [dayRows, setDayRows] = useState(null)
  const [authorRows, setAuthorRows] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => isoDateString(new Date()), [])
  const isSingleDay = range.start === range.end

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (isSingleDay) {
        const { data, error: rpcError } = await supabase.rpc('site_views_by_author', {
          target_date: range.start,
        })
        if (cancelled) return
        if (rpcError) {
          setError(rpcError.message)
          setAuthorRows([])
          return
        }
        setError('')
        setAuthorRows(data ?? [])
      } else {
        const { data, error: rpcError } = await supabase.rpc('site_views_by_day', {
          start_date: range.start,
          end_date: range.end,
        })
        if (cancelled) return
        if (rpcError) {
          setError(rpcError.message)
          setDayRows([])
          return
        }
        setError('')
        setDayRows(data ?? [])
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [range, isSingleDay])

  const byDay = useMemo(
    () => (dayRows ?? []).map((r) => ({ id: r.day, label: formatDay(r.day), views: r.views })),
    [dayRows],
  )
  const byAuthor = useMemo(
    () =>
      (authorRows ?? []).map((r) => ({
        id: r.author_id,
        label: r.display_name || 'Unknown author',
        views: r.views,
      })),
    [authorRows],
  )

  const totalViews = isSingleDay
    ? byAuthor.reduce((sum, r) => sum + r.views, 0)
    : byDay.reduce((sum, r) => sum + r.views, 0)
  const loading = isSingleDay ? authorRows === null : dayRows === null

  function handleStartChange(e) {
    const value = e.target.value
    setRange((r) => (value > r.end ? { start: value, end: value } : { ...r, start: value }))
  }

  function handleEndChange(e) {
    const value = e.target.value
    setRange((r) => (value < r.start ? { start: value, end: value } : { ...r, end: value }))
  }

  return (
    <section id="site-stats">
      <h2>Site traffic</h2>

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

      {loading ? (
        <p className="directory-status">Loading…</p>
      ) : isSingleDay ? (
        <>
          <p className="my-stats-total">
            <strong>{totalViews}</strong> hit{totalViews === 1 ? '' : 's'} on {formatDay(range.start)}, by author
          </p>
          <BarChart data={byAuthor} ariaLabel="Site hits per author" />
        </>
      ) : (
        <>
          <p className="my-stats-total">
            <strong>{totalViews}</strong> total hit{totalViews === 1 ? '' : 's'} from {formatDay(range.start)} to{' '}
            {formatDay(range.end)}
          </p>
          <BarChart data={byDay} ariaLabel="Site hits per day" />
        </>
      )}
    </section>
  )
}
