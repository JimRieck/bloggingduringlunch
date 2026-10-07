// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PostViewsTable } from '../../src/components/PostViewsTable.jsx'

afterEach(cleanup)

const rows = [
  { id: 'a', title: 'Most viewed', detail: 'My Blog · Ada', href: 'https://example.com/a', views: 150 },
  { id: 'b', title: 'Some views', views: 49 },
  { id: 'c', title: 'One view', views: 1 },
]

function cellsOf(row) {
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

describe('PostViewsTable', () => {
  it('lists every row it is given -- no top-N cut-off or "Other" bucket', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, title: `Post ${i}`, views: 40 - i }))
    render(<PostViewsTable heading="Every post viewed" rows={many} />)
    expect(screen.getAllByRole('row')).toHaveLength(41)
    expect(screen.queryByText('Other')).toBeNull()
  })

  it('shows views and each post’s share of the total, with "<1%" rather than a misleading 0%', () => {
    render(<PostViewsTable heading="Posts" rows={rows} />)
    const [, first, second, third] = screen.getAllByRole('row')
    expect(cellsOf(first)).toEqual(['Most viewedMy Blog · Ada', '150', '75%'])
    expect(cellsOf(second)).toEqual(['Some views', '49', '25%'])
    expect(cellsOf(third)).toEqual(['One view', '1', '<1%'])
  })

  it('links a title to its post in a new tab when given an href', () => {
    render(<PostViewsTable heading="Posts" rows={rows} />)
    const link = screen.getByRole('link', { name: /^Most viewed/ })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('makes every title a button that hands back its row, when given onSelect', () => {
    const onSelect = vi.fn()
    render(<PostViewsTable heading="Posts" rows={rows} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Some views' }))
    expect(onSelect).toHaveBeenCalledWith(rows[1])
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders nothing when no post had views', () => {
    const { container } = render(<PostViewsTable heading="Posts" rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
