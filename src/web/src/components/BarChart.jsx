import { useState } from 'react'

const WIDTH = 640
const HEIGHT = 220
const PAD_LEFT = 32
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 28
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM
const MAX_BAR_WIDTH = 24
const BAR_RADIUS = 4

// Rounds up to a "clean" axis max (1/2/5 × a power of ten) instead of
// the raw data max, so the top gridline reads as a real number.
function niceMax(value) {
  if (value <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * pow
    if (candidate >= value) return candidate
  }
  return Math.ceil(value / pow) * pow
}

// A bar with rounded top corners and a square baseline, per the
// dataviz skill's mark spec -- an SVG <rect rx> would round all four
// corners, so this builds the outline as an explicit path instead.
function topRoundedRectPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height))
  const top = y
  const bottom = y + height
  return [
    `M${x},${bottom}`,
    `L${x},${top + r}`,
    r > 0 ? `Q${x},${top} ${x + r},${top}` : '',
    `L${x + width - r},${top}`,
    r > 0 ? `Q${x + width},${top} ${x + width},${top + r}` : '',
    `L${x + width},${bottom}`,
    'Z',
  ]
    .filter(Boolean)
    .join(' ')
}

// A single-series bar chart: data.views per data.label, one bar per
// entry. No legend -- a single series' identity is already named by
// the chart's own title/subtitle, per the dataviz skill.
export function BarChart({ data, ariaLabel }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  if (data.length === 0) {
    return <p className="directory-status">No data for this range.</p>
  }

  const maxViews = niceMax(Math.max(1, ...data.map((d) => d.views)))
  const bandWidth = PLOT_WIDTH / data.length
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, bandWidth - 2))
  const xFor = (i) => PAD_LEFT + bandWidth * i + bandWidth / 2
  const yFor = (v) => PAD_TOP + PLOT_HEIGHT - (v / maxViews) * PLOT_HEIGHT

  const yTicks = [...new Set([0, Math.round(maxViews / 2), maxViews])]
  // Never label every bar -- thin them out once there are too many.
  const labelEvery = data.length <= 8 ? 1 : Math.ceil(data.length / 6)

  const hovered = hoverIndex !== null ? data[hoverIndex] : null

  return (
    <div className="bar-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={ariaLabel}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={yFor(tick)} y2={yFor(tick)} className="chart-gridline" />
            <text x={PAD_LEFT - 6} y={yFor(tick)} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
              {tick}
            </text>
          </g>
        ))}

        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={d.id} x={xFor(i)} y={HEIGHT - 8} className="chart-axis-label" textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}

        {data.map((d, i) => {
          const barHeight = (d.views / maxViews) * PLOT_HEIGHT
          return (
            <path
              key={d.id}
              d={topRoundedRectPath(xFor(i) - barWidth / 2, PAD_TOP + PLOT_HEIGHT - barHeight, barWidth, barHeight, BAR_RADIUS)}
              className={`chart-bar${hoverIndex === i ? ' chart-bar-hover' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(i)}
              onBlur={() => setHoverIndex(null)}
            >
              <title>
                {d.label}: {d.views} view{d.views === 1 ? '' : 's'}
              </title>
            </path>
          )
        })}
      </svg>

      {hovered && (
        <div className="chart-tooltip" style={{ left: `${(xFor(hoverIndex) / WIDTH) * 100}%` }}>
          <strong>{hovered.views}</strong> view{hovered.views === 1 ? '' : 's'}
          <span>{hovered.label}</span>
        </div>
      )}
    </div>
  )
}
