// Turns a post view's referring website (the domain the reader clicked
// through from) and utm_source tag into a named source and a type, for
// the admin "Traffic sources" section. A utm_source tag wins over the
// referrer, since it's set deliberately on the link -- e.g. the links
// the site posts to LinkedIn carry ?utm_source=linkedin, which still
// identifies LinkedIn when its mobile app hides the referrer.

export const SOURCE_TYPES = {
  social: 'Social',
  search: 'Search',
  ai: 'AI assistant',
  email: 'Email',
  tagged: 'Tagged link',
  website: 'Other website',
  internal: 'This site',
  direct: 'Direct / unknown',
}

// Checked in order, so specific hosts (gemini.google.com, mail.google.com)
// come before the general ones they'd otherwise match (google.*).
// `domains` match the host itself or any subdomain of it.
const KNOWN_SITES = [
  { name: 'ChatGPT', type: 'ai', domains: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Perplexity', type: 'ai', domains: ['perplexity.ai'] },
  { name: 'Claude', type: 'ai', domains: ['claude.ai'] },
  { name: 'Copilot', type: 'ai', domains: ['copilot.microsoft.com', 'copilot.cloud.microsoft'] },
  { name: 'Gemini', type: 'ai', domains: ['gemini.google.com', 'bard.google.com'] },
  { name: 'DeepSeek', type: 'ai', domains: ['chat.deepseek.com', 'deepseek.com'] },
  { name: 'Grok', type: 'ai', domains: ['grok.com'] },
  { name: 'Meta AI', type: 'ai', domains: ['meta.ai'] },
  { name: 'You.com', type: 'ai', domains: ['you.com'] },
  { name: 'Phind', type: 'ai', domains: ['phind.com'] },
  { name: 'Poe', type: 'ai', domains: ['poe.com'] },

  { name: 'Gmail', type: 'email', domains: ['mail.google.com'] },
  { name: 'Outlook', type: 'email', domains: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'] },
  { name: 'Yahoo Mail', type: 'email', domains: ['mail.yahoo.com'] },

  { name: 'LinkedIn', type: 'social', domains: ['linkedin.com', 'lnkd.in'] },
  { name: 'Facebook', type: 'social', domains: ['facebook.com', 'fb.com', 'fb.me'] },
  { name: 'X (Twitter)', type: 'social', domains: ['x.com', 'twitter.com', 't.co'] },
  { name: 'Instagram', type: 'social', domains: ['instagram.com'] },
  { name: 'Threads', type: 'social', domains: ['threads.net', 'threads.com'] },
  { name: 'Bluesky', type: 'social', domains: ['bsky.app'] },
  { name: 'Reddit', type: 'social', domains: ['reddit.com'] },
  { name: 'Hacker News', type: 'social', domains: ['news.ycombinator.com'] },
  { name: 'YouTube', type: 'social', domains: ['youtube.com', 'youtu.be'] },
  { name: 'Medium', type: 'social', domains: ['medium.com'] },
  { name: 'Slack', type: 'social', domains: ['slack.com'] },
  { name: 'Microsoft Teams', type: 'social', domains: ['teams.microsoft.com', 'teams.live.com'] },
  { name: 'Discord', type: 'social', domains: ['discord.com', 'discordapp.com'] },

  { name: 'Bing', type: 'search', domains: ['bing.com'] },
  { name: 'DuckDuckGo', type: 'search', domains: ['duckduckgo.com'] },
  { name: 'Yahoo', type: 'search', domains: ['search.yahoo.com', 'yahoo.com'] },
  { name: 'Brave Search', type: 'search', domains: ['search.brave.com'] },
  { name: 'Ecosia', type: 'search', domains: ['ecosia.org'] },
  { name: 'Baidu', type: 'search', domains: ['baidu.com'] },
  { name: 'Yandex', type: 'search', domains: ['yandex.com', 'yandex.ru'] },

  { name: 'This site', type: 'internal', domains: ['bloggingduringlunch.com', 'bloggingduringlunch.vercel.app', 'localhost'] },
]

// Google runs a search domain per country (google.co.uk, google.de...).
const GOOGLE = /(^|\.)google(\.[a-z]{2,3}){1,2}$/

// utm_source values people commonly use, mapped onto the same names.
const KNOWN_TAGS = {
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  fb: 'Facebook',
  twitter: 'X (Twitter)',
  x: 'X (Twitter)',
  instagram: 'Instagram',
  reddit: 'Reddit',
  bluesky: 'Bluesky',
  threads: 'Threads',
  chatgpt: 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  perplexity: 'Perplexity',
  email: 'Email',
  newsletter: 'Email',
  announcement: 'Email',
}

function matches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

export function classifySource({ referrerHost, utmSource }) {
  const tag = utmSource?.trim().toLowerCase()
  if (tag) {
    const name = KNOWN_TAGS[tag]
    if (name) {
      const site = KNOWN_SITES.find((s) => s.name === name)
      return { name, type: site?.type ?? 'email' }
    }
    return { name: tag, type: 'tagged' }
  }

  const host = referrerHost?.trim().toLowerCase().replace(/^www\./, '')
  if (!host) return { name: 'Direct / unknown', type: 'direct' }

  for (const site of KNOWN_SITES) {
    if (site.domains.some((domain) => matches(host, domain))) return { name: site.name, type: site.type }
  }
  if (GOOGLE.test(host)) return { name: 'Google', type: 'search' }
  if (host.endsWith('.localhost')) return { name: 'This site', type: 'internal' }
  return { name: host, type: 'website' }
}

// Rows from site_traffic_sources -> totals per source and per type, both
// busiest first.
export function summarizeSources(rows) {
  const bySource = new Map()
  const byType = new Map()
  let total = 0
  for (const row of rows) {
    const { name, type } = classifySource({ referrerHost: row.referrer_host, utmSource: row.utm_source })
    const key = `${type}:${name}`
    const source = bySource.get(key) ?? { name, type, views: 0 }
    source.views += row.views
    bySource.set(key, source)
    byType.set(type, (byType.get(type) ?? 0) + row.views)
    total += row.views
  }
  const busiestFirst = (a, b) => b.views - a.views || a.name.localeCompare(b.name)
  return {
    total,
    sources: [...bySource.values()].sort(busiestFirst),
    types: [...byType.entries()].map(([type, views]) => ({ type, name: SOURCE_TYPES[type], views })).sort(busiestFirst),
  }
}
