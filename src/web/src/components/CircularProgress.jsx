import './CircularProgress.css'

const STROKE_WIDTH = 3

// A small ring progress indicator -- value/max filled clockwise from the
// top, no charting library, same hand-rolled-SVG approach as BarChart.jsx.
export function CircularProgress({ value, max, size = 18 }) {
  const radius = (size - STROKE_WIDTH) / 2
  const circumference = 2 * Math.PI * radius
  const fraction = max > 0 ? Math.min(1, value / max) : 0
  const center = size / 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="circular-progress" role="presentation">
      <circle cx={center} cy={center} r={radius} className="circular-progress-track" strokeWidth={STROKE_WIDTH} fill="none" />
      <circle
        cx={center}
        cy={center}
        r={radius}
        className="circular-progress-fill"
        strokeWidth={STROKE_WIDTH}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
}
