// Records a signed-out visit to a public page (the home page), through
// the server function api/visit.js, which adds the visitor's rough
// location and stores it (site_visits, 20261124100000). Read on the
// "Home page visits" admin page (HomeVisits.jsx).
//
// Fire-and-forget: a visit that fails to record is never the visitor's
// problem. Under `vite dev` there's no /api, so it just 404s quietly.

// What the server function needs from the page itself: which page, the
// page the visitor came from, and the link's utm_source tag.
export function visitPayload(location, referrer) {
  const utmSource = new URLSearchParams(location.search).get('utm_source')
  return {
    path: location.pathname || '/',
    referrer: referrer || null,
    utmSource: utmSource?.trim() ? utmSource.trim().slice(0, 100) : null,
  }
}

let countryNames
function countryName(code) {
  try {
    countryNames ??= new Intl.DisplayNames(['en'], { type: 'region' })
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

// "Richmond, VA, United States" from a stored visit's city, region code
// and two-letter country code; whatever parts are known.
export function formatVisitLocation({ city, region, country }) {
  const parts = [city, region, country ? countryName(country) : null].filter((part) => part?.trim())
  return parts.length ? parts.join(', ') : 'Unknown'
}

export function recordSiteVisit(location = window.location, referrer = document.referrer) {
  try {
    return fetch('/api/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visitPayload(location, referrer)),
      keepalive: true,
    }).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}
