// Records one signed-out visit to a public page (today: the home page),
// for the "Home page visits" admin page. The browser posts here once per
// page load (src/web/src/lib/siteVisit.js) with the page and where the
// visitor came from; this function adds roughly where they are, from
// Vercel's own IP geolocation headers, and stores it all through
// record_site_visit (20261124100000_site_visits.sql).
//
// Why a server function rather than the browser calling Supabase
// directly: only requests to Vercel carry the x-vercel-ip-* location
// headers. The IP address itself is never passed on or stored.
//
// Best-effort, like og.js: anything going wrong is logged, and the
// visitor's page never waits on or notices it.

import { classifyBot } from '../src/lib/botUserAgents.js'

function header(req, name) {
  const value = req.headers[name]
  return typeof value === 'string' ? value : ''
}

// Vercel percent-encodes the city ("S%C3%A3o%20Paulo").
function decoded(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    res.status(405).end()
    return
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
  const body = parseBody(req)
  const path = text(body.path, 200)

  // Crawlers rarely run the script that calls this, but some headless
  // ones do; they aren't visitors.
  const bot = classifyBot(header(req, 'user-agent'))

  if (!SUPABASE_URL || !ANON_KEY || !path.startsWith('/') || bot) {
    res.status(204).end()
    return
  }

  try {
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_site_visit`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_path: path,
        p_referrer: text(body.referrer, 500) || null,
        p_utm_source: text(body.utmSource, 100) || null,
        p_country: header(req, 'x-vercel-ip-country').slice(0, 2) || null,
        p_region: header(req, 'x-vercel-ip-country-region').slice(0, 10) || null,
        p_city: decoded(header(req, 'x-vercel-ip-city')).slice(0, 100) || null,
      }),
    })
    if (!rpc.ok) console.error('visit: record_site_visit failed', rpc.status, await rpc.text().catch(() => ''))
  } catch (err) {
    console.error('visit: record_site_visit failed', err)
  }
  res.status(204).end()
}
