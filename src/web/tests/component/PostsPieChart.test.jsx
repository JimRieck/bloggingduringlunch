// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PostsPieChart } from '../../src/components/PostsPieChart.jsx'

afterEach(cleanup)

const posts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    title: `Post ${i}`,
    views: n - i, // strictly descending, no tie-break ambiguity
  }))

function sliceFills(container) {
  return [...container.querySelectorAll('.pie-slice')].map((path) => path.getAttribute('fill'))
}

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

  it('gives every viewed post its own slice and legend row -- no "Other" bucket', () => {
    const { container } = render(<PostsPieChart data={posts(25)} />)
    expect(container.querySelectorAll('.pie-slice')).toHaveLength(25)
    expect(container.querySelectorAll('.pie-legend li')).toHaveLength(25)
    expect(screen.getByText('Post 0')).toBeInTheDocument()
    expect(screen.getByText('Post 24')).toBeInTheDocument()
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('never gives two neighbouring slices the same colour, including where the circle closes', () => {
    for (const count of [2, 6, 7, 12, 13, 25]) {
      const { container, unmount } = render(<PostsPieChart data={posts(count)} />)
      const fills = sliceFills(container)
      fills.forEach((fill, i) => {
        const next = fills[(i + 1) % fills.length]
        expect(fill, `${count} slices, slice ${i}`).not.toBe(next)
      })
      unmount()
    }
  })

  it('labels a tiny share "<1%" rather than a misleading 0%', () => {
    render(
      <PostsPieChart
        data={[
          { id: 'big', title: 'Big', views: 250 },
          { id: 'tiny', title: 'Tiny', views: 1 },
        ]}
      />,
    )
    expect(screen.getByText('1 (<1%)')).toBeInTheDocument()
  })

  it('wraps long titles instead of cutting them off', () => {
    const title = 'What I’m Building Next: Engineering Leadership, Architecture, and Modern Delivery'
    render(<PostsPieChart data={[{ id: 'a', title, views: 3 }]} />)
    expect(screen.getByText(title)).toBeInTheDocument()
  })

  it('with onSelect, each legend row is a button that hands back its post', () => {
    const onSelect = vi.fn()
    render(<PostsPieChart data={posts(3)} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Post 1/ }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', title: 'Post 1' }))
  })

  it('without onSelect, the legend has no buttons', () => {
    render(<PostsPieChart data={posts(3)} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
