// Injects per-post Open Graph / Twitter Card meta tags into the SPA's
// index.html for a single post's permalink (/blog/:org/:post). Social
// crawlers (LinkedIn, Facebook, Slack, ...) don't run JavaScript, so
// without this they only ever see the static index.html shell -- which
// is identical for every URL -- and fall back to the generic site title
// with no image. This runs *before* the React app even loads, fetches
// the real post from Supabase, and rewrites the HTML's <head> with tags
// specific to that post; the same app then boots normally underneath for
// any real visitor.
//
// Deliberately defensive: any failure here (bad slug, Supabase down,
// missing env vars) just serves the normal, unmodified index.html rather
// than breaking the page for a real visitor.

import { classifyBot } from '../src/lib/botUserAgents.js'

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function excerpt(html, max = 160) {
  const text = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trimEnd()}…`
}

async function fetchIndexHtml(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const res = await fetch(`${proto}://${host}/index.html`)
  return res.text()
}

function sendHtml(res, html) {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.status(200).send(html)
}

// Crawlers never run the page's JavaScript, which is what records a
// reader's view -- this is the one place they can be seen. Recorded
// separately from readers (bot_visits, via record_bot_visit), never as a
// view. Best-effort: a failure is logged, not shown to anyone.
async function recordBotVisit(supabaseUrl, headers, { orgSlug, postSlug, bot, userAgent }) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/record_bot_visit`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_org_slug: orgSlug,
        p_post_slug: postSlug,
        p_bot_name: bot.name,
        p_bot_category: bot.category,
        p_user_agent: userAgent.slice(0, 400),
      }),
    })
    if (!res.ok) console.error('og: record_bot_visit failed', res.status, await res.text().catch(() => ''))
  } catch (err) {
    console.error('og: record_bot_visit failed', err)
  }
}

export default async function handler(req, res) {
  const html = await fetchIndexHtml(req).catch(() => null)
  if (html === null) {
    res.status(500).end('Error loading page')
    return
  }

  // Started alongside the post lookup, and waited for before answering
  // (a serverless function can be frozen as soon as it responds).
  let botRecording = null
  const send = async (body) => {
    await botRecording
    sendHtml(res, body)
  }

  try {
    const { org: orgSlug, post: postSlug } = req.query
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL
    const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

    if (!SUPABASE_URL || !ANON_KEY || !orgSlug || !postSlug) {
      sendHtml(res, html)
      return
    }

    const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }

    const userAgent = String(req.headers['user-agent'] ?? '')
    const bot = classifyBot(userAgent)
    if (bot) botRecording = recordBotVisit(SUPABASE_URL, headers, { orgSlug, postSlug, bot, userAgent })

    const orgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations_public?select=id,name&slug=eq.${encodeURIComponent(orgSlug)}`,
      { headers },
    )
    const [org] = await orgRes.json()
    if (!org) {
      await send(html)
      return
    }

    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?select=title,content,thumbnail_url&organization_id=eq.${org.id}&slug=eq.${encodeURIComponent(postSlug)}&status=eq.published`,
      { headers },
    )
    const [post] = await postRes.json()
    if (!post) {
      await send(html)
      return
    }

    // Build the canonical URL from the known clean parts rather than
    // req.url -- inside the function, req.url reflects the rewrite's
    // internal routing (e.g. "...?org=bdl&post=working-from-home"), not
    // the public-facing path visitors and crawlers actually see.
    // A utm_source tag (e.g. ?utm_source=linkedin on links the site posts
    // to LinkedIn) stays on og:url, so a network that sends readers to
    // the og:url still delivers it and the visit is credited correctly.
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const utmSource = typeof req.query.utm_source === 'string' ? req.query.utm_source.slice(0, 100) : ''
    const pageUrl = `${proto}://${req.headers.host}/blog/${encodeURIComponent(orgSlug)}/${encodeURIComponent(postSlug)}${
      utmSource ? `?utm_source=${encodeURIComponent(utmSource)}` : ''
    }`
    const title = escapeHtml(post.title)
    const description = escapeHtml(excerpt(post.content))
    const image = post.thumbnail_url ? escapeHtml(post.thumbnail_url) : null

    const tags = [
      '<meta property="og:type" content="article" />',
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
      `<meta property="og:site_name" content="${escapeHtml(org.name)}" />`,
      image ? `<meta property="og:image" content="${image}" />` : '',
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `<meta name="twitter:title" content="${title}" />`,
      `<meta name="twitter:description" content="${description}" />`,
      image ? `<meta name="twitter:image" content="${image}" />` : '',
    ]
      .filter(Boolean)
      .join('\n    ')

    await send(html.replace('</head>', `    ${tags}\n  </head>`))
  } catch (err) {
    console.error('og function error:', err)
    await send(html)
  }
}
