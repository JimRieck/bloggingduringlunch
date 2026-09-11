// @vitest-environment jsdom
//
// Component test, not an integration test -- pure rendering logic,
// no Supabase/network involved. This project's first: the existing
// suite (see tests/integration/) only covers backend/RLS behavior,
// which an external code review flagged as leaving UI-only bugs
// uncaught (wrong value rendered, empty state not shown, etc).
// BarChart.jsx is a good first candidate since it's presentational
// and deterministic from its props, no mocking required.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BarChart } from '../../src/components/BarChart.jsx'

describe('BarChart', () => {
  it('shows the empty-state message instead of a chart when there is no data', () => {
    render(<BarChart data={[]} ariaLabel="Test chart" />)
    expect(screen.getByText('No data for this range.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders one bar per data point, each with an accessible label and value', () => {
    const data = [
      { id: 'mon', label: 'Mon', views: 3 },
      { id: 'tue', label: 'Tue', views: 0 },
      { id: 'wed', label: 'Wed', views: 7 },
    ]
    const { container } = render(<BarChart data={data} ariaLabel="Views per day" />)

    const chart = screen.getByRole('img', { name: 'Views per day' })
    expect(chart).toBeInTheDocument()

    // Every entry (views: 0 included) is its own bar -- a zero-filled
    // day is still a real data point, not an omitted one.
    expect(chart.querySelectorAll('.chart-bar')).toHaveLength(3)

    // Each bar's accessible name is the label + exact view count,
    // carried by an SVG <title> child -- what a screen reader (or a
    // test) actually gets when it asks "what is this bar." <title>'s
    // text is split across several JSX-interpolated nodes, so this
    // reads each one's normalized textContent rather than matching
    // one literal string the DOM doesn't actually contain as such.
    const titles = [...container.querySelectorAll('.chart-bar title')].map((t) => t.textContent)
    expect(titles).toEqual(['Mon: 3 views', 'Tue: 0 views', 'Wed: 7 views'])
  })

  it('singularizes "view" for an exact count of 1', () => {
    const { container } = render(<BarChart data={[{ id: 'a', label: 'A', views: 1 }]} ariaLabel="Test chart" />)
    expect(container.querySelector('.chart-bar title').textContent).toBe('A: 1 view')
  })

  it('thins x-axis labels past 8 bars but always keeps the last one', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, label: `Day ${i}`, views: i }))
    render(<BarChart data={data} ariaLabel="Test chart" />)

    // labelEvery = ceil(20 / 6) = 4 -> indices 0, 4, 8, 12, 16, plus
    // the last (19) even though it doesn't land on that step.
    expect(screen.getByText('Day 0')).toBeInTheDocument()
    expect(screen.getByText('Day 4')).toBeInTheDocument()
    expect(screen.getByText('Day 19')).toBeInTheDocument()
    expect(screen.queryByText('Day 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Day 18')).not.toBeInTheDocument()
  })
})
