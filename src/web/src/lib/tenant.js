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
