import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../api/visit.js'

// api/visit.js only runs as a Vercel function (not under `vite dev`), so
// it's tested here directly, like og.js: a fake request/response and a
// stand-in for Supabase.
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

let rpcCalls
let rpcBehaviour

function request({ method = 'POST', body, userAgent = CHROME, geo = {} } = {}) {
  return {
    method,
    headers: {
      host: 'bloggingduringlunch.com',
      'user-agent': userAgent,
      'x-forwarded-for': '203.0.113.7',
      ...geo,
    },
    body: body ?? { path: '/', referrer: 'https://www.linkedin.com/feed/', utmSource: null },
  }
}

function response() {
  const res = {
    statusCode: null,
    headers: {},
    setHeader(name, value) {
      res.headers[name] = value
    },
    status(code) {
      res.statusCode = code
      return res
    },
    end() {},
  }
  return res
}

beforeEach(() => {
  rpcCalls = []
  rpcBehaviour = async () => new Response(null, { status: 204 })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://db.example')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      if (url !== 'https://db.example/rest/v1/rpc/record_site_visit') throw new Error(`unexpected fetch ${url}`)
      rpcCalls.push({ body: JSON.parse(init.body), headers: init.headers })
      return rpcBehaviour()
    }),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('visit function', () => {
  it('records the page, referrer and Vercel’s location headers, with the public key -- and never the IP', async () => {
    const res = response()
    await handler(
      request({
        geo: {
          'x-vercel-ip-country': 'BR',
          'x-vercel-ip-country-region': 'SP',
          'x-vercel-ip-city': 'S%C3%A3o%20Paulo',
        },
      }),
      res,
    )
    expect(res.statusCode).toBe(204)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].headers).toMatchObject({ apikey: 'anon-key', Authorization: 'Bearer anon-key' })
    expect(rpcCalls[0].body).toEqual({
      p_path: '/',
      p_referrer: 'https://www.linkedin.com/feed/',
      p_utm_source: null,
      p_country: 'BR',
      p_region: 'SP',
      p_city: 'São Paulo',
    })
    expect(JSON.stringify(rpcCalls[0].body)).not.toContain('203.0.113.7')
  })

  it('passes the utm_source tag, and records unknown location as null', async () => {
    await handler(request({ body: { path: '/', referrer: '', utmSource: 'linkedin' } }), response())
    expect(rpcCalls[0].body).toMatchObject({
      p_referrer: null,
      p_utm_source: 'linkedin',
      p_country: null,
      p_region: null,
      p_city: null,
    })
  })

  it('accepts a body sent as text (e.g. by sendBeacon)', async () => {
    await handler(request({ body: JSON.stringify({ path: '/', referrer: null }) }), response())
    expect(rpcCalls[0].body.p_path).toBe('/')
  })

  it('records nothing for a bot, a missing or invalid page, or a GET', async () => {
    await handler(request({ userAgent: GOOGLEBOT }), response())
    await handler(request({ body: { referrer: 'https://x.com/' } }), response())
    await handler(request({ body: { path: 'https://evil.example/' } }), response())
    const get = response()
    await handler(request({ method: 'GET' }), get)
    expect(get.statusCode).toBe(405)
    expect(rpcCalls).toEqual([])
  })

  it('answers normally when recording fails', async () => {
    rpcBehaviour = async () => new Response('boom', { status: 500 })
    const res = response()
    await handler(request(), res)
    expect(res.statusCode).toBe(204)
    expect(console.error).toHaveBeenCalled()
  })
})
