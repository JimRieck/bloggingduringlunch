// Domains this app is served from directly (not a tenant subdomain).
// "localhost" covers local dev; the production apex domain is added
// once the site is actually deployed there.
const BASE_DOMAINS = ['bloggingduringlunch.com', 'localhost']

// Resolves "<slug>.bloggingduringlunch.com" (or "<slug>.localhost" for
// local dev -- modern browsers resolve *.localhost to loopback with no
// hosts-file changes needed) to a tenant slug. Returns null for the
// bare apex/www domain, where the site shows the marketing landing
// page instead of a tenant's blog.
export function getTenantSlugFromHostname(hostname = window.location.hostname) {
  const host = hostname.toLowerCase()
  for (const base of BASE_DOMAINS) {
    if (host === base || host === `www.${base}`) return null
    const suffix = `.${base}`
    if (host.endsWith(suffix)) {
      const subdomain = host.slice(0, -suffix.length)
      if (subdomain && subdomain !== 'www') return subdomain
    }
  }
  return null
}

// Builds the public URL for a tenant's blog (optionally deep-linked to a
// specific post via its slug, as a real path segment -- not a "#" hash
// fragment, which never reaches the server at all, so a crawler (or
// anything else server-side) can't tell which post is being requested).
// Uses the path-based "/blog/<slug>" route rather than
// "<slug>.bloggingduringlunch.com" -- the subdomain form is what tenant
// routing actually uses, but wildcard subdomains aren't enabled in
// production yet (blocked on Vercel's free tier), so a link built that
// way looks right but doesn't resolve. The path form works everywhere
// today with no DNS changes needed.
export function getTenantUrl(slug, postSlug) {
  const postPath = postSlug ? `/${postSlug}` : ''
  return `${window.location.origin}/blog/${slug}${postPath}`
}
