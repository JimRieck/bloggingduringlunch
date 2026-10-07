// Every post with views in a date range, most-viewed first, with its
// share of the total -- the full list behind the "All posts" pie (which
// shows only the top 5 + "Other") and the admin site traffic chart.
// Each row is { id, title, detail?, href?, views }. A title opens the
// post (href) or, given `onSelect`, drills into that post instead.
function share(views, total) {
  if (total === 0) return '—'
  const percent = (views / total) * 100
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

// Title plus its "blog · author" line, both inside the link/button, so
// the whole two-line block is the tap target.
function PostLabel({ row }) {
  return (
    <>
      <span className="post-views-name">{row.title}</span>
      {row.detail && <span className="post-views-detail">{row.detail}</span>}
    </>
  )
}

export function PostViewsTable({ heading, rows, onSelect }) {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + r.views, 0)

  return (
    <div className="post-views">
      <h3 className="post-views-heading">{heading}</h3>
      <table className="post-views-table">
        <thead>
          <tr>
            <th>Post</th>
            <th className="post-views-number">Views</th>
            <th className="post-views-number">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {onSelect ? (
                  <button type="button" className="post-views-title" onClick={() => onSelect(r)}>
                    <PostLabel row={r} />
                  </button>
                ) : r.href ? (
                  <a className="post-views-title" href={r.href} target="_blank" rel="noopener noreferrer">
                    <PostLabel row={r} />
                  </a>
                ) : (
                  <span className="post-views-title">
                    <PostLabel row={r} />
                  </span>
                )}
              </td>
              <td className="post-views-number">{r.views}</td>
              <td className="post-views-number">{share(r.views, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
