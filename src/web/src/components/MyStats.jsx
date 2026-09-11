import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { ViewsLineChart } from './ViewsLineChart.jsx'
import { PostsPieChart } from './PostsPieChart.jsx'
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

function formatDay(dateStr) {
  // Every date in this component (the range boundaries, the `day`
  // column my_post_views_by_day returns) is a UTC calendar date,
  // string-built to avoid timezone drift -- this display label has to
  // stay in UTC too, or it silently shows the wrong day for anyone
  // not on UTC (confirmed: without this, America/New_York showed Sep
  // 4/5/7 for views actually grouped under Sep 5/6/8).
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function MyStats({ posts }) {
  const postsLoaded = posts !== null
  const publishedPosts = useMemo(() => (posts ?? []).filter((p) => p.status === 'published'), [posts])
  const publishedPostIds = useMemo(() => publishedPosts.map((p) => p.id), [publishedPosts])

  const [range, setRange] = useState(defaultRange)
  const [selectedPostId, setSelectedPostId] = useState('all')
  const [postRows, setPostRows] = useState(null)
  const [dayRows, setDayRows] = useState(null)
  const [error, setError] = useState('')

  // Derived, not synced back into state via an effect: if the
  // selected post gets unpublished/deleted out from under this
  // filter, this falls back to "All posts" the instant `publishedPosts`
  // changes, with no stale-selection render in between.
  const effectiveSelectedPostId =
    selectedPostId === 'all' || publishedPosts.some((p) => p.id === selectedPostId) ? selectedPostId : 'all'

  // Both RPCs group and sum in the database rather than fetching raw
  // post_views rows and summing them in the browser -- the previous
  // approach didn't scale past PostgREST's 1,000-row default response
  // cap (a popular post over a wide range would silently undercount,
  // not error), same issue as the admin site traffic chart had.
  useEffect(() => {
    if (publishedPostIds.length === 0) return
    let cancelled = false

    async function load() {
      if (effectiveSelectedPostId === 'all') {
        const { data, error: rpcError } = await supabase.rpc('my_post_views_by_post', {
          post_ids: publishedPostIds,
          start_date: range.start,
          end_date: range.end,
        })
        if (cancelled) return
        if (rpcError) {
          setError(rpcError.message)
          setPostRows([])
          return
        }
        setError('')
        setPostRows(data ?? [])
      } else {
        const { data, error: rpcError } = await supabase.rpc('my_post_views_by_day', {
          target_post_id: effectiveSelectedPostId,
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
  }, [publishedPostIds, range, effectiveSelectedPostId])

  const postTitleById = useMemo(
    () => new Map(publishedPosts.map((p) => [p.id, p.title])),
    [publishedPosts],
  )

  const byPost = useMemo(() => {
    if (!postRows) return []
    const viewsById = new Map(postRows.map((r) => [r.post_id, r.views]))
    return publishedPosts
      .map((p) => ({ id: p.id, title: p.title, views: viewsById.get(p.id) ?? 0 }))
      .sort((a, b) => b.views - a.views)
  }, [postRows, publishedPosts])

  const byDay = useMemo(() => (dayRows ?? []).map((r) => ({ date: r.day, views: r.views })), [dayRows])

  // Only ever displayed in the single-post branch below -- "All
  // posts" shows its own per-slice totals via PostsPieChart instead.
  const totalViews = (dayRows ?? []).reduce((sum, r) => sum + r.views, 0)
  const loading = effectiveSelectedPostId === 'all' ? postRows === null : dayRows === null
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
          <select value={effectiveSelectedPostId} onChange={(e) => setSelectedPostId(e.target.value)}>
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

      {!postsLoaded ? (
        <p className="directory-status">Loading…</p>
      ) : publishedPosts.length === 0 ? (
        <p className="directory-status">Publish a post to start seeing stats.</p>
      ) : loading ? (
        <p className="directory-status">Loading…</p>
      ) : effectiveSelectedPostId === 'all' ? (
        <PostsPieChart data={byPost} />
      ) : (
        <>
          <p className="my-stats-total">
            <strong>{totalViews}</strong> view{totalViews === 1 ? '' : 's'} for &ldquo;
            {postTitleById.get(effectiveSelectedPostId)}&rdquo;
          </p>
          <ViewsLineChart data={byDay} formatLabel={formatDay} />
        </>
      )}
    </section>
  )
}
