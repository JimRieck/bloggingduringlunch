// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AutoSaveStatus } from '../../src/components/AutoSaveStatus.jsx'
import '@testing-library/jest-dom/vitest'

afterEach(cleanup)

// 14:42 UTC in October is 10:42 AM Eastern.
const savedAt = new Date('2026-10-23T14:42:00Z')

describe('AutoSaveStatus', () => {
  it.each([
    [{ state: 'idle', savedAt: null }, false, /^Saves automatically$/],
    [{ state: 'idle', savedAt: null }, true, /stay private until you publish/],
    [{ state: 'saving', savedAt }, false, /^Saving…$/],
    [{ state: 'saved', savedAt }, false, /^Draft saved 10:42/],
    [{ state: 'saved', savedAt }, true, /^Changes saved privately at 10:42.*not live until you publish$/],
    [{ state: 'error', savedAt }, false, /^Couldn’t save — retrying$/],
    [{ state: 'conflict', savedAt }, false, /changed somewhere else/],
  ])('%o (pending: %s)', (status, pending, text) => {
    render(<AutoSaveStatus status={status} pending={pending} />)
    expect(screen.getByRole('status')).toHaveTextContent(text)
  })
})
