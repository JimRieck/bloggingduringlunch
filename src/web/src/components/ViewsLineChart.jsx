import { useState } from 'react'

const WIDTH = 640
const HEIGHT = 220
const PAD_LEFT = 32
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 28
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM

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

export function ViewsLineChart({ data, formatLabel }) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const maxViews = niceMax(Math.max(1, ...data.map((d) => d.views)))
  const xFor = (i) =>
    PAD_LEFT + (data.length === 1 ? PLOT_WIDTH / 2 : (i / (data.length - 1)) * PLOT_WIDTH)
  const yFor = (v) => PAD_TOP + PLOT_HEIGHT - (v / maxViews) * PLOT_HEIGHT

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(d.views)}`).join(' ')
  const yTicks = [...new Set([0, Math.round(maxViews / 2), maxViews])]
  // Never label every point -- thin them out once the range gets long,
  // always keeping the last point so the axis doesn't dead-end early.
  const labelEvery = data.length <= 8 ? 1 : Math.ceil(data.length / 6)

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH
    let nearest = 0
    let nearestDist = Infinity
    data.forEach((_, i) => {
      const dist = Math.abs(xFor(i) - x)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    })
    setHoverIndex(nearest)
  }

  const hovered = hoverIndex !== null ? data[hoverIndex] : null

  return (
    <div className="views-line-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Views per day"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
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
            <text key={d.date} x={xFor(i)} y={HEIGHT - 8} className="chart-axis-label" textAnchor="middle">
              {formatLabel(d.date)}
            </text>
          ) : null,
        )}

        <path d={linePath} className="chart-line" />

        {data.map((d, i) => (
          <circle key={d.date} cx={xFor(i)} cy={yFor(d.views)} r={4} className="chart-marker" />
        ))}

        {hovered && (
          <>
            <line
              x1={xFor(hoverIndex)}
              x2={xFor(hoverIndex)}
              y1={PAD_TOP}
              y2={HEIGHT - PAD_BOTTOM}
              className="chart-crosshair"
            />
            <circle cx={xFor(hoverIndex)} cy={yFor(hovered.views)} r={6} className="chart-marker chart-marker-hover" />
          </>
        )}
      </svg>

      {hovered && (
        <div className="chart-tooltip" style={{ left: `${(xFor(hoverIndex) / WIDTH) * 100}%` }}>
          <strong>{hovered.views}</strong> view{hovered.views === 1 ? '' : 's'}
          <span>{formatLabel(hovered.date)}</span>
        </div>
      )}
    </div>
  )
}
