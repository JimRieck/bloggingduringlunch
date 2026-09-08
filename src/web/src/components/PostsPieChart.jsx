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
const MAX_SLICES = 6
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

export function PostsPieChart({ data }) {
  const [hoverId, setHoverId] = useState(null)

  const { slices, total } = useMemo(() => {
    const total = data.reduce((sum, d) => sum + d.views, 0)
    const sorted = [...data].filter((d) => d.views > 0).sort((a, b) => b.views - a.views)

    let combined = sorted
    if (sorted.length > MAX_SLICES) {
      const top = sorted.slice(0, MAX_SLICES - 1)
      const otherViews = sorted.slice(MAX_SLICES - 1).reduce((sum, d) => sum + d.views, 0)
      combined = [...top, { id: '__other__', title: 'Other', views: otherViews }]
    }

    const slices = combined.reduce((acc, d, i) => {
      const startAngle = acc.length > 0 ? acc[acc.length - 1].endAngle : 0
      const fraction = total > 0 ? d.views / total : 0
      acc.push({
        ...d,
        startAngle,
        endAngle: startAngle + fraction * 360,
        color: d.id === '__other__' ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length],
        percent: total > 0 ? Math.round((d.views / total) * 100) : 0,
      })
      return acc
    }, [])
    return { slices, total }
  }, [data])

  if (total === 0) {
    return <p className="directory-status">No views yet in this range.</p>
  }

  return (
    <div className="posts-pie-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Share of views by post">
        {slices.map((s) => {
          const gapped = s.endAngle - s.startAngle > GAP_DEGREES * 2
          const start = gapped ? s.startAngle + GAP_DEGREES / 2 : s.startAngle
          const end = gapped ? s.endAngle - GAP_DEGREES / 2 : s.endAngle
          return (
            <path
              key={s.id}
              d={arcPath(start, end)}
              fill={s.color}
              className={`pie-slice${hoverId === s.id ? ' pie-slice-hover' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setHoverId(s.id)}
              onMouseLeave={() => setHoverId(null)}
              onFocus={() => setHoverId(s.id)}
              onBlur={() => setHoverId(null)}
            >
              <title>
                {s.title}: {s.views} view{s.views === 1 ? '' : 's'} ({s.percent}%)
              </title>
            </path>
          )
        })}
      </svg>

      {/* Doubles as the required "table view" for this chart -- always
          visible, not gated behind hover, since a pie's colors alone
          can't be reliably compared. */}
      <ul className="pie-legend">
        {slices.map((s) => (
          <li
            key={s.id}
            className={hoverId === s.id ? 'pie-legend-hover' : ''}
            onMouseEnter={() => setHoverId(s.id)}
            onMouseLeave={() => setHoverId(null)}
          >
            <span className="pie-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="pie-legend-title">{s.title}</span>
            <span className="pie-legend-value">
              {s.views} ({s.percent}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
