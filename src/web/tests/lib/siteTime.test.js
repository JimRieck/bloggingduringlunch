import { describe, expect, it } from 'vitest'
import {
  formatDayLabel,
  formatSiteDate,
  formatSiteDateTime,
  formatSiteTime,
  formatSiteLongDate,
  siteDateDaysAgo,
  siteDateString,
} from '../../src/lib/siteTime.js'

// The bug this fixes: after 8pm Eastern (midnight UTC in summer), the
// site's "today" and its day buckets had already rolled over to
// tomorrow.
describe('siteDateString', () => {
  it('9pm Eastern in October is still that day, though it’s already tomorrow in UTC', () => {
    expect(siteDateString(new Date('2026-10-20T01:00:00Z'))).toBe('2026-10-19')
  })

  it('just after midnight Eastern is the new day', () => {
    expect(siteDateString(new Date('2026-10-20T04:30:00Z'))).toBe('2026-10-20')
  })

  it('uses winter time (EST, UTC-5) in January: 11:30pm on the 14th', () => {
    expect(siteDateString(new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14')
  })
})

describe('siteDateDaysAgo', () => {
  const lateEvening = new Date('2026-10-20T01:00:00Z') // Oct 19, 9pm EDT

  it('counts back from today’s Eastern date, not the UTC one', () => {
    expect(siteDateDaysAgo(0, lateEvening)).toBe('2026-10-19')
    expect(siteDateDaysAgo(6, lateEvening)).toBe('2026-10-13')
  })

  it('crosses month ends', () => {
    expect(siteDateDaysAgo(29, new Date('2026-10-01T15:00:00Z'))).toBe('2026-09-02')
  })

  it('isn’t thrown off by a daylight-saving change in the range', () => {
    // Clocks went forward on March 8, 2026.
    expect(siteDateDaysAgo(1, new Date('2026-03-09T15:00:00Z'))).toBe('2026-03-08')
    expect(siteDateDaysAgo(7, new Date('2026-03-12T03:30:00Z'))).toBe('2026-03-04')
  })
})

describe('formatting', () => {
  it('labels a calendar date as that date, whatever zone runs the code', () => {
    expect(formatDayLabel('2026-10-19')).toMatch(/Oct\D*19/)
  })

  it('shows a stored timestamp’s Eastern date', () => {
    expect(formatSiteLongDate('2026-10-20T01:00:00Z')).toBe('October 19, 2026')
    expect(formatSiteDate('2026-10-20T01:00:00Z')).toBe('10/19/2026')
  })

  it('shows date and time in Eastern, naming the zone', () => {
    const shown = formatSiteDateTime('2026-10-20T01:05:00Z')
    expect(shown).toMatch(/Oct 19, 2026/)
    expect(shown).toMatch(/9:05/)
    expect(shown).toMatch(/EDT/)
    expect(formatSiteDateTime('2026-01-15T04:30:00Z')).toMatch(/Jan 14, 2026.*11:30.*EST/)
  })
})

describe('formatSiteTime', () => {
  it('shows the Eastern time of day, whatever the device’s zone', () => {
    // 01:05 UTC on Oct 20 is 9:05pm Eastern (EDT) on Oct 19.
    expect(formatSiteTime('2026-10-20T01:05:00Z')).toMatch(/9:05/)
    expect(formatSiteTime('2026-10-20T01:05:00Z')).toMatch(/PM/i)
  })
})
