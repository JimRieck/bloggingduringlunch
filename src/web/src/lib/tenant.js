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
// specific post via its slug), using whichever base domain and port the
// app is currently running on -- so this produces the right link in both
// local dev ("*.localhost:5173") and production ("*.bloggingduringlunch.com").
export function getTenantUrl(slug, postSlug) {
  const { protocol, hostname, port } = window.location
  const base = BASE_DOMAINS.find((b) => hostname === b || hostname === `www.${b}`) ?? BASE_DOMAINS[0]
  const portSuffix = port ? `:${port}` : ''
  const hash = postSlug ? `#${postSlug}` : ''
  return `${protocol}//${slug}.${base}${portSuffix}/${hash}`
}
