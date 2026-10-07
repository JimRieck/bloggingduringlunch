// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PostsPieChart } from '../../src/components/PostsPieChart.jsx'

afterEach(cleanup)

const posts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    title: `Post ${i}`,
    views: n - i, // strictly descending, no tie-break ambiguity
  }))

const otherRow = () => screen.getByRole('button', { name: /^Other, / })

describe('PostsPieChart', () => {
  it('shows a status message instead of a chart when every post has zero views', () => {
    render(<PostsPieChart data={[{ id: 'a', title: 'A', views: 0 }]} />)
    expect(screen.getByText('No views yet in this range.')).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
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

  it('caps at 6 slices, folding the rest into "Other", with no colour used twice', () => {
    // 9, 8, 7, 6, 5, 4, 3, 2, 1 views
    const { container } = render(<PostsPieChart data={posts(9)} />)

    // Top 5 (views 9..5) keep their own slice; the remaining 4 (views
    // 4,3,2,1 = 10 of 45) share one "Other" slice, for 6 slices total.
    const fills = [...container.querySelectorAll('.pie-slice')].map((p) => p.getAttribute('fill'))
    expect(fills).toHaveLength(6)
    expect(new Set(fills).size).toBe(6)
    expect(screen.getByText('Post 4')).toBeInTheDocument()
    expect(screen.queryByText('Post 5')).not.toBeInTheDocument()
    expect(screen.getByText('Other (4 posts)')).toBeInTheDocument()
    expect(screen.getByText(`10 (${Math.round((10 / 45) * 100)}%)`)).toBeInTheDocument()
  })

  it('exactly 6 posts each keep their own slice -- no "Other" for a single leftover', () => {
    render(<PostsPieChart data={posts(6)} />)
    expect(screen.getByText('Post 5')).toBeInTheDocument()
    expect(screen.queryByText(/Other/)).toBeNull()
  })

  it('clicking the "Other" legend row lists exactly the posts it groups, and clicking again hides them', () => {
    render(<PostsPieChart data={posts(9)} />)
    const row = otherRow()
    expect(row).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('list', { name: 'Posts in Other' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Post 54 (9%)',
      'Post 63 (7%)',
      'Post 72 (4%)',
      'Post 81 (2%)',
    ])

    fireEvent.click(row)
    expect(screen.queryByRole('list', { name: 'Posts in Other' })).toBeNull()
  })

  it('clicking the "Other" slice of the pie opens the same list, also from the keyboard', () => {
    render(<PostsPieChart data={posts(9)} />)
    const slice = screen.getByRole('button', { name: /^Other: 10 views/ })
    fireEvent.click(slice)
    expect(screen.getByRole('list', { name: 'Posts in Other' })).toBeInTheDocument()
    fireEvent.keyDown(slice, { key: 'Enter' })
    expect(screen.queryByRole('list', { name: 'Posts in Other' })).toBeNull()
  })

  it('"Other" opens even without onSelect, since knowing what is in it matters everywhere', () => {
    render(<PostsPieChart data={posts(9)} />)
    fireEvent.click(otherRow())
    expect(screen.getByText('Post 8')).toBeInTheDocument()
  })

  it('with onSelect, a post’s legend row, its slice, and a post inside "Other" all hand back that post', () => {
    const onSelect = vi.fn()
    render(<PostsPieChart data={posts(9)} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: /^Post 1, / }))
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }))

    fireEvent.click(screen.getByRole('button', { name: /^Post 2: / }))
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p2' }))

    fireEvent.click(otherRow())
    fireEvent.click(screen.getByRole('button', { name: /^Post 7, / }))
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p7' }))
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('reads each legend row as title, views and share -- not run together', () => {
    render(<PostsPieChart data={posts(9)} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Post 1, 8 views, 18%' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Other, 4 posts, 10 views, 22%' })).toBeInTheDocument()
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
})
