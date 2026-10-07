// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnnouncementRecipients } from '../../src/components/AnnouncementRecipients.jsx'

// Vitest runs without globals here, so Testing Library can't register
// its own between-test cleanup.
afterEach(cleanup)

const people = (n) =>
  Array.from({ length: n }, (_, i) => ({ user_id: `u${i}`, display_name: `Person ${i}`, email: `p${i}@example.com` }))

function renderPicker(recipients, excluded = []) {
  const onChange = vi.fn()
  render(<AnnouncementRecipients recipients={recipients} excludedIds={new Set(excluded)} onChange={onChange} />)
  return onChange
}

describe('AnnouncementRecipients', () => {
  it('ticks everyone when nobody has been unchecked, and says so', () => {
    renderPicker(people(3))
    expect(screen.getAllByRole('checkbox').every((box) => box.checked)).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('3 of 3 selected')
  })

  it('shows unchecked people as unchecked and counts them out', () => {
    renderPicker(people(3), ['u1'])
    expect(screen.getAllByRole('checkbox').map((box) => box.checked)).toEqual([true, false, true])
    expect(screen.getByRole('status')).toHaveTextContent('2 of 3 selected')
  })

  it('unchecking someone adds them to the excluded set; re-checking removes them', () => {
    const onChange = renderPicker(people(3), ['u2'])
    fireEvent.click(screen.getByLabelText(/Person 0/))
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['u0', 'u2'])
    fireEvent.click(screen.getByLabelText(/Person 2/))
    expect([...onChange.mock.calls[1][0]]).toEqual([])
  })

  it('Select none excludes everyone; Select all clears the exclusions', () => {
    const onChange = renderPicker(people(3), ['u1'])
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['u0', 'u1', 'u2'])
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect([...onChange.mock.calls[1][0]]).toEqual([])
  })

  it('shows the email under the name, or just the email when there is no name', () => {
    renderPicker([
      { user_id: 'a', display_name: 'Ada', email: 'ada@example.com' },
      { user_id: 'b', display_name: null, email: 'nameless@example.com' },
    ])
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(screen.getAllByText('nameless@example.com')).toHaveLength(1)
  })

  it('only offers a filter box once the list is long, and filters by name or email', () => {
    const { unmount } = render(
      <AnnouncementRecipients recipients={people(8)} excludedIds={new Set()} onChange={() => {}} />,
    )
    expect(screen.queryByLabelText('Filter recipients')).toBeNull()
    unmount()

    renderPicker(people(12))
    fireEvent.change(screen.getByLabelText('Filter recipients'), { target: { value: 'p11@' } })
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByText('Person 11')).toBeInTheDocument()
    // The count still covers everyone, not just the filtered rows.
    expect(screen.getByRole('status')).toHaveTextContent('12 of 12 selected')
  })

  it('says when the filter matches nobody', () => {
    renderPicker(people(12))
    fireEvent.change(screen.getByLabelText('Filter recipients'), { target: { value: 'zzz' } })
    expect(screen.getByText('No one matches “zzz”.')).toBeInTheDocument()
  })
})
