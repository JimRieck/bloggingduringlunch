import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { isoDateDaysAgo } from '../lib/aiUsage.js'
import { summarizeSources, SOURCE_TYPES } from '../lib/trafficSources.js'
import { BOT_CATEGORIES } from '../lib/botUserAgents.js'
import './MyStats.css'

function share(views, total) {
  if (!total) return '—'
  const percent = (views / total) * 100
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

// Where site traffic comes from, for the admin page: readers by source
// (from each view's referrer and utm_source tag, site_traffic_sources /
// 20261008100000) and, separately, bots and crawlers (bot_visit_summary)
// -- which never count as views.
export function TrafficSources() {
  const [range, setRange] = useState(() => ({ start: isoDateDaysAgo(29), end: isoDateDaysAgo(0) }))
  const [sourceRows, setSourceRows] = useState(null)
  const [botRows, setBotRows] = useState(null)
  const [error, setError] = useState('')
  const today = useMemo(() => isoDateDaysAgo(0), [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const args = { start_date: range.start, end_date: range.end }
      const [sources, bots] = await Promise.all([
        supabase.rpc('site_traffic_sources', args),
        supabase.rpc('bot_visit_summary', args),
      ])
      if (cancelled) return
      setError(sources.error || bots.error ? 'Couldn’t load traffic sources. Try again.' : '')
      setSourceRows(sources.data ?? [])
      setBotRows(bots.data ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [range])

  const summary = useMemo(() => summarizeSources(sourceRows ?? []), [sourceRows])
  const botTotal = (botRows ?? []).reduce((sum, r) => sum + r.visits, 0)

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
    <section id="traffic-sources">
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

      {sourceRows === null || botRows === null ? (
        <p className="directory-status">Loading…</p>
      ) : (
        <>
          <h3 className="admin-subheading">
            Readers ({summary.total} view{summary.total === 1 ? '' : 's'})
          </h3>
          {summary.total === 0 ? (
            <p className="post-views-note">No post views in this range.</p>
          ) : (
            <>
              <p className="post-views-hint">
                Where people reading a post came from. &ldquo;{SOURCE_TYPES.direct}&rdquo; means their browser or app
                didn&rsquo;t say &mdash; typed or bookmarked links, and many phone apps.
              </p>

              <table className="post-views-table traffic-types">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th className="post-views-number">Views</th>
                    <th className="post-views-number">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.types.map((t) => (
                    <tr key={t.type}>
                      <td>{t.name}</td>
                      <td className="post-views-number">{t.views}</td>
                      <td className="post-views-number">{share(t.views, summary.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="post-views-table traffic-sources-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th className="post-views-number">Views</th>
                    <th className="post-views-number">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.sources.map((s) => (
                    <tr key={`${s.type}:${s.name}`}>
                      <td>
                        <span className="post-views-name">{s.name}</span>
                        {SOURCE_TYPES[s.type] !== s.name && (
                          <span className="post-views-detail">{SOURCE_TYPES[s.type]}</span>
                        )}
                      </td>
                      <td className="post-views-number">{s.views}</td>
                      <td className="post-views-number">{share(s.views, summary.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 className="admin-subheading">
            Bots and crawlers ({botTotal} visit{botTotal === 1 ? '' : 's'})
          </h3>
          {botTotal === 0 ? (
            <p className="post-views-note">No bot visits recorded in this range.</p>
          ) : (
            <>
              <p className="post-views-hint">
                Automated visitors that fetched a post page. They aren&rsquo;t counted as views. A link-preview bot (like
                LinkedIn&rsquo;s) fetching a post usually means someone shared or posted the link.
              </p>
              <table className="post-views-table">
                <thead>
                  <tr>
                    <th>Bot</th>
                    <th className="post-views-number">Visits</th>
                    <th className="post-views-number">Posts</th>
                  </tr>
                </thead>
                <tbody>
                  {botRows.map((b) => (
                    <tr key={`${b.bot_category}:${b.bot_name}`}>
                      <td>
                        <span className="post-views-name">{b.bot_name}</span>
                        <span className="post-views-detail">
                          {BOT_CATEGORIES[b.bot_category] ?? b.bot_category} · last seen{' '}
                          {new Date(b.last_seen).toLocaleDateString()}
                        </span>
                      </td>
                      <td className="post-views-number">{b.visits}</td>
                      <td className="post-views-number">{b.posts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  )
}
