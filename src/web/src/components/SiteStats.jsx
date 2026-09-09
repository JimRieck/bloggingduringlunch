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

function listDatesBetween(startDate, endDate) {
  const dates = []
  let cur = new Date(`${startDate}T00:00:00Z`)
  const last = new Date(`${endDate}T00:00:00Z`)
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return dates
}

// Every date here is a UTC calendar date (the range boundaries, the
// group-by key derived from viewed_at) -- this display label has to
// stay in UTC too, or it silently shows the wrong day for anyone not
// on UTC (see MyStats.jsx, where this exact thing bit the line chart).
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
export function SiteStats() {
  const [range, setRange] = useState(defaultRange)
  const [rows, setRows] = useState(null)
  const [authorRows, setAuthorRows] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => isoDateString(new Date()), [])
  const isSingleDay = range.start === range.end

  useEffect(() => {
    setError('')
    setRows(null)

    const startIso = `${range.start}T00:00:00.000Z`
    const endExclusive = new Date(`${range.end}T00:00:00.000Z`)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

    supabase
      .from('post_views')
      .select('post_id, viewed_at')
      .gte('viewed_at', startIso)
      .lt('viewed_at', endExclusive.toISOString())
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message)
          setRows([])
          return
        }
        setRows(data ?? [])
      })
  }, [range])

  useEffect(() => {
    if (!isSingleDay || rows === null) {
      setAuthorRows(null)
      return
    }
    if (rows.length === 0) {
      setAuthorRows([])
      return
    }

    let cancelled = false

    async function loadAuthors() {
      const postIds = [...new Set(rows.map((r) => r.post_id))]
      // Two-step fetch, not an embedded `posts(author_id)` select --
      // same reasoning as RecentPosts.jsx/MyStats.jsx: safer to look
      // up author names via the anon-readable public_profiles view
      // than to lean on an embed across two separately-scoped tables.
      const { data: postRows } = await supabase.from('posts').select('id, author_id').in('id', postIds)
      if (cancelled) return

      const authorIdByPost = new Map((postRows ?? []).map((p) => [p.id, p.author_id]))
      const authorIds = [...new Set((postRows ?? []).map((p) => p.author_id))]
      const { data: profileRows } = authorIds.length
        ? await supabase.from('public_profiles').select('id, display_name').in('id', authorIds)
        : { data: [] }
      if (cancelled) return

      const nameById = new Map((profileRows ?? []).map((p) => [p.id, p.display_name]))
      const counts = new Map()
      for (const row of rows) {
        const authorId = authorIdByPost.get(row.post_id)
        if (!authorId) continue
        counts.set(authorId, (counts.get(authorId) ?? 0) + 1)
      }
      setAuthorRows(
        [...counts.entries()]
          .map(([id, views]) => ({ id, label: nameById.get(id) || 'Unknown author', views }))
          .sort((a, b) => b.views - a.views),
      )
    }

    loadAuthors()
    return () => {
      cancelled = true
    }
  }, [isSingleDay, rows])

  const byDay = useMemo(() => {
    if (!rows) return []
    const days = listDatesBetween(range.start, range.end)
    const counts = new Map(days.map((d) => [d, 0]))
    for (const row of rows) {
      const day = row.viewed_at.slice(0, 10)
      if (counts.has(day)) counts.set(day, counts.get(day) + 1)
    }
    return days.map((d) => ({ id: d, label: formatDay(d), views: counts.get(d) }))
  }, [rows, range])

  const totalViews = rows?.length ?? 0
  const loading = rows === null || (isSingleDay && authorRows === null)

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
          <BarChart data={authorRows} ariaLabel="Site hits per author" />
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
