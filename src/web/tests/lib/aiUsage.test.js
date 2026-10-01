import { describe, expect, it } from 'vitest'
import { aiFeatureLabel, isoDateDaysAgo } from '../../src/lib/aiUsage.js'

describe('aiFeatureLabel', () => {
  it('returns the display label for a known feature key', () => {
    expect(aiFeatureLabel('titles')).toBe('Suggest titles')
  })

  it('falls back to the raw key for a feature with no label yet', () => {
    expect(aiFeatureLabel('some_new_feature')).toBe('some_new_feature')
  })
})

describe('isoDateDaysAgo', () => {
  it('returns today as a UTC date for 0 days back', () => {
    expect(isoDateDaysAgo(0, new Date('2026-10-01T15:30:00Z'))).toBe('2026-10-01')
  })

  it('crosses a month boundary', () => {
    expect(isoDateDaysAgo(29, new Date('2026-10-01T15:30:00Z'))).toBe('2026-09-02')
  })

  it('uses the UTC date, not the local one, late in the evening west of UTC', () => {
    // 11:30pm on Sept 30 in New York is already Oct 1 in UTC.
    expect(isoDateDaysAgo(0, new Date('2026-10-01T03:30:00Z'))).toBe('2026-10-01')
  })
})
