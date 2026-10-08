import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../api/og.js'

// api/og.js only runs as a Vercel function (not under `vite dev`), so
// it's tested here directly: a fake request/response, and `fetch`
// replaced by a stand-in for the site's index.html and Supabase.
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot'
const LINKEDINBOT = 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'

let events
let rpcCalls
let rpcBehaviour

function fakeFetch() {
  return vi.fn(async (url, init) => {
    if (url.endsWith('/index.html')) return new Response('<html><head></head><body></body></html>')
    if (url.includes('/rest/v1/organizations_public')) return Response.json([{ id: 'org-1', name: 'My Blog' }])
    if (url.includes('/rest/v1/posts')) {
      return Response.json([{ title: 'Hello world', content: '<p>Hi there</p>', thumbnail_url: null }])
    }
    if (url.includes('/rest/v1/rpc/record_bot_visit')) {
      rpcCalls.push({ url, body: JSON.parse(init.body), headers: init.headers })
      return rpcBehaviour()
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function request(userAgent, query = {}) {
  return {
    headers: { host: 'bloggingduringlunch.com', 'x-forwarded-proto': 'https', 'user-agent': userAgent },
    query: { org: 'my-blog', post: 'hello-world', ...query },
  }
}

function response() {
  const res = {
    statusCode: null,
    body: undefined,
    setHeader() {},
    status(code) {
      res.statusCode = code
      return res
    },
    send(body) {
      events.push('sent')
      res.body = body
    },
    end(body) {
      res.body = body
    },
  }
  return res
}

beforeEach(() => {
  events = []
  rpcCalls = []
  rpcBehaviour = async () => {
    events.push('recorded')
    return new Response(null, { status: 204 })
  }
  vi.stubEnv('VITE_SUPABASE_URL', 'https://db.example')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubGlobal('fetch', fakeFetch())
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('og function', () => {
  it('serves the page with the post’s preview tags, and records nothing for a person’s browser', async () => {
    const res = response()
    await handler(request(CHROME), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<meta property="og:title" content="Hello world" />')
    expect(rpcCalls).toEqual([])
  })

  it('records an AI crawler as a bot visit to that post, with the public key', async () => {
    const res = response()
    await handler(request(GPTBOT), res)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].url).toBe('https://db.example/rest/v1/rpc/record_bot_visit')
    expect(rpcCalls[0].headers.apikey).toBe('anon-key')
    expect(rpcCalls[0].body).toEqual({
      p_org_slug: 'my-blog',
      p_post_slug: 'hello-world',
      p_bot_name: 'GPTBot (OpenAI)',
      p_bot_category: 'ai',
      p_user_agent: GPTBOT,
    })
    expect(res.body).toContain('og:title')
  })

  it('records a link-preview bot too', async () => {
    await handler(request(LINKEDINBOT), response())
    expect(rpcCalls[0].body).toMatchObject({ p_bot_name: 'LinkedIn', p_bot_category: 'preview' })
  })

  it('finishes recording before it answers (a serverless function can be frozen once it responds)', async () => {
    rpcBehaviour = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push('recorded')
      return new Response(null, { status: 204 })
    }
    await handler(request(GPTBOT), response())
    expect(events).toEqual(['recorded', 'sent'])
  })

  it('still serves the page normally if recording fails', async () => {
    rpcBehaviour = async () => {
      throw new Error('network down')
    }
    const res = response()
    await handler(request(GPTBOT), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('og:title')
  })

  it('keeps a utm_source tag on og:url, so a network linking to og:url still carries it', async () => {
    const res = response()
    await handler(request(LINKEDINBOT, { utm_source: 'linkedin' }), res)
    expect(res.body).toContain(
      '<meta property="og:url" content="https://bloggingduringlunch.com/blog/my-blog/hello-world?utm_source=linkedin" />',
    )
  })

  it('leaves og:url clean without a tag', async () => {
    const res = response()
    await handler(request(CHROME), res)
    expect(res.body).toContain('<meta property="og:url" content="https://bloggingduringlunch.com/blog/my-blog/hello-world" />')
  })
})
