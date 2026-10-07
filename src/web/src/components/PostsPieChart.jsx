import { useMemo, useState } from 'react'

const SIZE = 200
const RADIUS = 90
const CENTER = SIZE / 2
const GAP_DEGREES = 1.5
// Six categorical colours is about the limit for telling hues apart, so
// past six the palette repeats (see sliceColor) and the legend --
// colour plus title plus exact count -- is what identifies a slice.
const SLICE_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)']
const NEUTRAL_COLOR = 'var(--cat-other)'

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

// A slice's colour: the palette in order, repeating past 6 -- which
// never puts the same colour on two neighbouring slices, except where
// the circle closes (last next to first); that one gets the neutral
// colour instead.
function sliceColor(index, count) {
  const color = SLICE_COLORS[index % SLICE_COLORS.length]
  const wrapsOntoFirst = count > 1 && index === count - 1 && index % SLICE_COLORS.length === 0
  return wrapsOntoFirst ? NEUTRAL_COLOR : color
}

function percentLabel(views, total) {
  const percent = (views / total) * 100
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

// Every post with views gets its own slice and legend row, most-viewed
// first -- no "Other" bucket, so the legend is the full list. Small
// posts become thin slivers; the legend's exact numbers are what make
// them readable. `onSelect`, if given, makes each legend row a button.
export function PostsPieChart({ data, onSelect }) {
  const [hoverId, setHoverId] = useState(null)

  const { slices, total } = useMemo(() => {
    const total = data.reduce((sum, d) => sum + d.views, 0)
    const sorted = [...data].filter((d) => d.views > 0).sort((a, b) => b.views - a.views)

    const slices = sorted.reduce((acc, d, i) => {
      const startAngle = acc.length > 0 ? acc[acc.length - 1].endAngle : 0
      acc.push({
        ...d,
        startAngle,
        endAngle: startAngle + (d.views / total) * 360,
        color: sliceColor(i, sorted.length),
        percent: percentLabel(d.views, total),
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
                {s.title}: {s.views} view{s.views === 1 ? '' : 's'} ({s.percent})
              </title>
            </path>
          )
        })}
      </svg>

      {/* Doubles as the required "table view" for this chart -- always
          visible, not gated behind hover, since a pie's colors alone
          can't be reliably compared. */}
      <ul className="pie-legend">
        {slices.map((s) => {
          const content = (
            <>
              <span className="pie-swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="pie-legend-title">{s.title}</span>
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
              {onSelect ? (
                <button
                  type="button"
                  className="pie-legend-row"
                  onClick={() => onSelect(s)}
                  onFocus={() => setHoverId(s.id)}
                  onBlur={() => setHoverId(null)}
                >
                  {content}
                </button>
              ) : (
                <span className="pie-legend-row">{content}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
