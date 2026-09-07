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

export default async function handler(req, res) {
  const html = await fetchIndexHtml(req).catch(() => null)
  if (html === null) {
    res.status(500).end('Error loading page')
    return
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

    const orgRes = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations_public?select=id,name&slug=eq.${encodeURIComponent(orgSlug)}`,
      { headers },
    )
    const [org] = await orgRes.json()
    if (!org) {
      sendHtml(res, html)
      return
    }

    const postRes = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?select=title,content,thumbnail_url&organization_id=eq.${org.id}&slug=eq.${encodeURIComponent(postSlug)}&status=eq.published`,
      { headers },
    )
    const [post] = await postRes.json()
    if (!post) {
      sendHtml(res, html)
      return
    }

    const proto = req.headers['x-forwarded-proto'] || 'https'
    const pageUrl = `${proto}://${req.headers.host}${req.url}`
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

    sendHtml(res, html.replace('</head>', `    ${tags}\n  </head>`))
  } catch (err) {
    console.error('og function error:', err)
    sendHtml(res, html)
  }
}
