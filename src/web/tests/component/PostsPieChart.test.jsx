// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostsPieChart } from '../../src/components/PostsPieChart.jsx'

describe('PostsPieChart', () => {
  it('shows a status message instead of a chart when every post has zero views', () => {
    render(<PostsPieChart data={[{ id: 'a', title: 'A', views: 0 }]} />)
    expect(screen.getByText('No views yet in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('excludes zero-view posts and sorts the rest largest-first, with exact percentages', () => {
    const data = [
      { id: 'a', title: 'A', views: 1 },
      { id: 'b', title: 'B', views: 0 },
      { id: 'c', title: 'C', views: 3 },
    ]
    render(<PostsPieChart data={data} />)

    // b (0 views) never appears -- a post nobody's read yet isn't a
    // meaningful slice of "share of views."
    expect(screen.queryByText('B')).not.toBeInTheDocument()

    const titles = screen.getAllByText(/^[AC]$/).map((el) => el.textContent)
    expect(titles).toEqual(['C', 'A']) // largest (3) before smallest (1)

    expect(screen.getByText('3 (75%)')).toBeInTheDocument()
    expect(screen.getByText('1 (25%)')).toBeInTheDocument()
  })

  it('caps at 6 slices, folding the rest into "Other"', () => {
    const data = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`,
      title: `Post ${i}`,
      views: 9 - i, // 9, 8, 7, 6, 5, 4, 3, 2, 1 -- strictly descending, no tie-break ambiguity
    }))
    render(<PostsPieChart data={data} />)

    // Top 5 (views 9..5) keep their own slice; the remaining 4
    // (views 4,3,2,1 = 10 total) fold into one "Other" slice, for 6
    // legend rows total -- never a 7th individually-colored slice
    // (adjacent-hue distinguishability breaks down past ~6).
    expect(screen.getByText('Post 0')).toBeInTheDocument()
    expect(screen.getByText('Post 4')).toBeInTheDocument()
    expect(screen.queryByText('Post 5')).not.toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()

    const total = 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1 // 45
    const otherViews = 4 + 3 + 2 + 1 // 10
    const otherPercent = Math.round((otherViews / total) * 100)
    expect(screen.getByText(`${otherViews} (${otherPercent}%)`)).toBeInTheDocument()
  })
})
