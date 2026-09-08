import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { ViewsLineChart } from './ViewsLineChart.jsx'
import './UserDirectory.css'
import './MyStats.css'

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

function formatDay(dateStr) {
  // Every date in this component (the range boundaries, the group-by
  // key derived from viewed_at) is a UTC calendar date, string-built
  // to avoid timezone drift -- this display label has to stay in UTC
  // too, or it silently shows the wrong day for anyone not on UTC
  // (confirmed: without this, America/New_York showed Sep 4/5/7 for
  // views actually grouped under Sep 5/6/8).
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function MyStats({ posts }) {
  const postsLoaded = posts !== null
  const publishedPosts = useMemo(() => (posts ?? []).filter((p) => p.status === 'published'), [posts])

  const [range, setRange] = useState(defaultRange)
  const [selectedPostId, setSelectedPostId] = useState('all')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  // If the selected post gets unpublished/deleted out from under this
  // filter, fall back to "All posts" instead of pointing at a post
  // that's no longer a valid option.
  useEffect(() => {
    if (selectedPostId === 'all') return
    if (!publishedPosts.some((p) => p.id === selectedPostId)) setSelectedPostId('all')
  }, [publishedPosts, selectedPostId])

  useEffect(() => {
    if (publishedPosts.length === 0) {
      setRows([])
      return
    }
    setError('')
    setRows(null)

    const startIso = `${range.start}T00:00:00.000Z`
    const endExclusive = new Date(`${range.end}T00:00:00.000Z`)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

    const postIds = selectedPostId === 'all' ? publishedPosts.map((p) => p.id) : [selectedPostId]

    supabase
      .from('post_views')
      .select('post_id, viewed_at')
      .in('post_id', postIds)
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
  }, [publishedPosts, range, selectedPostId])

  const postTitleById = useMemo(
    () => new Map(publishedPosts.map((p) => [p.id, p.title])),
    [publishedPosts],
  )

  const byPost = useMemo(() => {
    if (!rows) return []
    const counts = new Map()
    for (const row of rows) counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1)
    return publishedPosts
      .map((p) => ({ id: p.id, title: p.title, views: counts.get(p.id) ?? 0 }))
      .sort((a, b) => b.views - a.views)
  }, [rows, publishedPosts])

  const byDay = useMemo(() => {
    if (!rows) return []
    const days = listDatesBetween(range.start, range.end)
    const counts = new Map(days.map((d) => [d, 0]))
    for (const row of rows) {
      const day = row.viewed_at.slice(0, 10)
      if (counts.has(day)) counts.set(day, counts.get(day) + 1)
    }
    return days.map((d) => ({ date: d, views: counts.get(d) }))
  }, [rows, range])

  const totalViews = rows?.length ?? 0
  const today = useMemo(() => isoDateString(new Date()), [])

  function handleStartChange(e) {
    const value = e.target.value
    setRange((r) => (value > r.end ? { start: value, end: value } : { ...r, start: value }))
  }

  function handleEndChange(e) {
    const value = e.target.value
    setRange((r) => (value < r.start ? { start: value, end: value } : { ...r, end: value }))
  }

  return (
    <section id="my-stats">
      <h2>My stats</h2>

      <div className="my-stats-filters">
        <label className="my-stats-field">
          <span>Start date</span>
          <input type="date" value={range.start} max={range.end} onChange={handleStartChange} />
        </label>
        <label className="my-stats-field">
          <span>End date</span>
          <input type="date" value={range.end} min={range.start} max={today} onChange={handleEndChange} />
        </label>
        <label className="my-stats-field">
          <span>Post</span>
          <select value={selectedPostId} onChange={(e) => setSelectedPostId(e.target.value)}>
            <option value="all">All posts</option>
            {publishedPosts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {!postsLoaded || rows === null ? (
        <p className="directory-status">Loading…</p>
      ) : publishedPosts.length === 0 ? (
        <p className="directory-status">Publish a post to start seeing stats.</p>
      ) : selectedPostId === 'all' ? (
        <div className="directory-table-wrap">
          <table className="directory-table">
            <thead>
              <tr>
                <th>Post</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {byPost.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.views}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="my-stats-total">
            <strong>{totalViews}</strong> view{totalViews === 1 ? '' : 's'} for &ldquo;
            {postTitleById.get(selectedPostId)}&rdquo;
          </p>
          <ViewsLineChart data={byDay} formatLabel={formatDay} />
        </>
      )}
    </section>
  )
}
