import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { getTenantUrl } from '../lib/tenant.js'
import { BarChart } from './BarChart.jsx'
import { PostViewsTable } from './PostViewsTable.jsx'
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
//
// Under the chart, every post viewed in the selected range (or day),
// most-viewed first (site_views_by_post / 20261007120000). Clicking a
// day's bar drills into that day; "Back" returns to the range.
export function SiteStats() {
  const [range, setRange] = useState(defaultRange)
  // The range to go back to after drilling into a single day.
  const [drilledFrom, setDrilledFrom] = useState(null)
  const [dayRows, setDayRows] = useState(null)
  const [authorRows, setAuthorRows] = useState(null)
  const [postRows, setPostRows] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => isoDateString(new Date()), [])
  const isSingleDay = range.start === range.end

  useEffect(() => {
    let cancelled = false
    supabase
      .rpc('site_views_by_post', { start_date: range.start, end_date: range.end })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError) setError(rpcError.message)
        setPostRows(data ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [range])

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

  const byPost = useMemo(
    () =>
      (postRows ?? []).map((r) => ({
        id: r.post_id,
        title: r.title ?? 'Unpublished post',
        detail: [r.blog_name, r.author_name].filter(Boolean).join(' · '),
        href: r.blog_slug && r.post_slug ? getTenantUrl(r.blog_slug, r.post_slug) : undefined,
        views: r.views,
      })),
    [postRows],
  )

  function handleStartChange(e) {
    const value = e.target.value
    setDrilledFrom(null)
    setRange((r) => (value > r.end ? { start: value, end: value } : { ...r, start: value }))
  }

  function handleEndChange(e) {
    const value = e.target.value
    setDrilledFrom(null)
    setRange((r) => (value < r.start ? { start: value, end: value } : { ...r, end: value }))
  }

  function drillIntoDay(day) {
    setDrilledFrom(range)
    setRange({ start: day.id, end: day.id })
  }

  function backToRange() {
    setRange(drilledFrom)
    setDrilledFrom(null)
  }

  return (
    <section id="site-stats">
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

      {drilledFrom && (
        <p className="site-stats-back">
          <button type="button" className="link" onClick={backToRange}>
            ← Back to {formatDay(drilledFrom.start)} – {formatDay(drilledFrom.end)}
          </button>
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
          <BarChart data={byDay} ariaLabel="Site hits per day" onSelect={drillIntoDay} />
          {totalViews > 0 && <p className="post-views-hint">Click a day to see just that day&rsquo;s posts.</p>}
        </>
      )}

      {!loading && postRows !== null && (
        <PostViewsTable
          heading={`Posts viewed ${isSingleDay ? `on ${formatDay(range.start)}` : 'in this range'} (${byPost.length})`}
          rows={byPost}
        />
      )}
    </section>
  )
}
