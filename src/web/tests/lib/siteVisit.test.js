import { describe, expect, it } from 'vitest'
import { formatVisitLocation, visitPayload } from '../../src/lib/siteVisit.js'

describe('visitPayload', () => {
  it('takes the page, the referring page and the utm_source tag', () => {
    expect(visitPayload({ pathname: '/', search: '?utm_source=linkedin' }, 'https://www.google.com/')).toEqual({
      path: '/',
      referrer: 'https://www.google.com/',
      utmSource: 'linkedin',
    })
  })

  it('sends null for no referrer and no (or a blank) tag', () => {
    expect(visitPayload({ pathname: '/', search: '' }, '')).toEqual({ path: '/', referrer: null, utmSource: null })
    expect(visitPayload({ pathname: '/', search: '?utm_source=%20' }, '').utmSource).toBeNull()
  })
})

describe('formatVisitLocation', () => {
  it('names the country and keeps whatever parts are known', () => {
    expect(formatVisitLocation({ city: 'Richmond', region: 'VA', country: 'US' })).toBe('Richmond, VA, United States')
    expect(formatVisitLocation({ city: null, region: null, country: 'DE' })).toBe('Germany')
  })

  it('says "Unknown" when nothing is known', () => {
    expect(formatVisitLocation({ city: null, region: null, country: null })).toBe('Unknown')
  })
})
