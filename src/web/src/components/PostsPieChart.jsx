import { useMemo, useState } from 'react'

const SIZE = 200
const RADIUS = 90
const CENTER = SIZE / 2
const GAP_DEGREES = 1.5
// Pie/donut slices are only reliably distinguishable by color up to
// about this many -- past it, adjacent-slice contrast degrades and
// "which color was which" stops working. The rest fold into "Other"
// rather than adding a 7th/8th hue (see the dataviz skill's
// anti-patterns: "<= 6 segments" for part-to-whole at a glance).
// "Other" opens up to list exactly which posts it contains.
const MAX_SLICES = 6
const OTHER_ID = '__other__'
const SLICE_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)']
const OTHER_COLOR = 'var(--cat-other)'

function polarToCartesian(angleDeg) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTER + RADIUS * Math.cos(rad), y: CENTER + RADIUS * Math.sin(rad) }
}

function arcPath(startAngle, endAngle) {
  const start = polarToCartesian(endAngle)
  const end = polarToCartesian(startAngle)
  const largeArc = endAngle - startAngle > 180 ? 1 : 0
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 0 ${end.x} ${end.y} Z`
}

function percentLabel(views, total) {
  const percent = (views / total) * 100
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

// "8 views, 18%" -- spoken labels keep the title and the numbers apart
// (read straight from the markup, "Post 1" + "8 (18%)" runs together).
function viewsLabel(d) {
  return `${d.views} view${d.views === 1 ? '' : 's'}, ${d.percent}`
}

// Enter/Space on a focused SVG slice, the same as a click.
function onActivateKey(action) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      action()
    }
  }
}

// Share of views per post, most-viewed first: the top 5 get their own
// slice, the rest share an "Other" slice. Clicking "Other" (the slice
// or its legend row) lists the posts inside it. `onSelect`, if given,
// is called with a post when its slice or legend row is clicked.
export function PostsPieChart({ data, onSelect }) {
  const [hoverId, setHoverId] = useState(null)
  const [otherOpen, setOtherOpen] = useState(false)

  const { slices, total } = useMemo(() => {
    const total = data.reduce((sum, d) => sum + d.views, 0)
    const sorted = [...data]
      .filter((d) => d.views > 0)
      .sort((a, b) => b.views - a.views)
      .map((d) => ({ ...d, percent: percentLabel(d.views, total) }))

    let combined = sorted
    if (sorted.length > MAX_SLICES) {
      const top = sorted.slice(0, MAX_SLICES - 1)
      const rest = sorted.slice(MAX_SLICES - 1)
      const otherViews = rest.reduce((sum, d) => sum + d.views, 0)
      combined = [
        ...top,
        { id: OTHER_ID, title: 'Other', views: otherViews, percent: percentLabel(otherViews, total), posts: rest },
      ]
    }

    const slices = combined.reduce((acc, d, i) => {
      const startAngle = acc.length > 0 ? acc[acc.length - 1].endAngle : 0
      acc.push({
        ...d,
        startAngle,
        endAngle: startAngle + (d.views / total) * 360,
        color: d.id === OTHER_ID ? OTHER_COLOR : SLICE_COLORS[i],
      })
      return acc
    }, [])
    return { slices, total }
  }, [data])

  if (total === 0) {
    return <p className="directory-status">No views yet in this range.</p>
  }

  const activate = (slice) => {
    if (slice.id === OTHER_ID) setOtherOpen((open) => !open)
    else onSelect?.(slice)
  }
  const isClickable = (slice) => slice.id === OTHER_ID || !!onSelect

  return (
    <div className="posts-pie-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Share of views by post">
        {slices.map((s) => {
          const gapped = s.endAngle - s.startAngle > GAP_DEGREES * 2
          const start = gapped ? s.startAngle + GAP_DEGREES / 2 : s.startAngle
          const end = gapped ? s.endAngle - GAP_DEGREES / 2 : s.endAngle
          const clickable = isClickable(s)
          const label = `${s.title}: ${s.views} view${s.views === 1 ? '' : 's'} (${s.percent})`
          return (
            <path
              key={s.id}
              d={arcPath(start, end)}
              fill={s.color}
              className={`pie-slice${hoverId === s.id ? ' pie-slice-hover' : ''}${clickable ? ' pie-slice-clickable' : ''}`}
              tabIndex={0}
              role={clickable ? 'button' : 'img'}
              aria-label={label}
              aria-expanded={s.id === OTHER_ID ? otherOpen : undefined}
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
              onFocus={() => setHoverId(s.id)}
              onBlur={() => setHoverId(null)}
              onClick={clickable ? () => activate(s) : undefined}
              onKeyDown={clickable ? onActivateKey(() => activate(s)) : undefined}
            >
              <title>{label}</title>
            </path>
          )
        })}
      </svg>

      {/* Doubles as the required "table view" for this chart -- always
          visible, not gated behind hover, since a pie's colors alone
          can't be reliably compared. */}
      <ul className="pie-legend">
        {slices.map((s) => {
          const isOther = s.id === OTHER_ID
          const content = (
            <>
              <span className="pie-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="pie-legend-title">
                {isOther ? (
                  <>
                    <span className="pie-other-caret" aria-hidden="true">
                      {otherOpen ? '▾' : '▸'}
                    </span>
                    Other ({s.posts.length} posts)
                  </>
                ) : (
                  s.title
                )}
              </span>
              <span className="pie-legend-value">
                {s.views} ({s.percent})
              </span>
            </>
          )
          return (
            <li
              key={s.id}
              className={hoverId === s.id ? 'pie-legend-hover' : ''}
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
            >
              {isClickable(s) ? (
                <button
                  type="button"
                  className="pie-legend-row"
                  aria-label={
                    isOther
                      ? `Other, ${s.posts.length} posts, ${viewsLabel(s)}`
                      : `${s.title}, ${viewsLabel(s)}`
                  }
                  aria-expanded={isOther ? otherOpen : undefined}
                  onClick={() => activate(s)}
                  onFocus={() => setHoverId(s.id)}
                  onBlur={() => setHoverId(null)}
                >
                  {content}
                </button>
              ) : (
                <span className="pie-legend-row">{content}</span>
              )}
              {isOther && otherOpen && (
                <ul className="pie-other-list" aria-label="Posts in Other">
                  {s.posts.map((p) => (
                    <li key={p.id}>
                      {onSelect ? (
                        <button
                          type="button"
                          className="pie-legend-row"
                          aria-label={`${p.title}, ${viewsLabel(p)}`}
                          onClick={() => onSelect(p)}
                        >
                          <span className="pie-legend-title">{p.title}</span>
                          <span className="pie-legend-value">
                            {p.views} ({p.percent})
                          </span>
                        </button>
                      ) : (
                        <span className="pie-legend-row">
                          <span className="pie-legend-title">{p.title}</span>
                          <span className="pie-legend-value">
                            {p.views} ({p.percent})
                          </span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
