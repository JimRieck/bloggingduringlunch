// Recognises crawlers and bots from a request's User-Agent header, for
// the post-link server function (src/web/api/og.js), which records them
// separately from readers (bot_visits). Plain JavaScript with no
// browser APIs, so the server function can import it too.
//
// Categories: 'ai' (AI companies' crawlers and assistants fetching a
// page for a user), 'search' (search engines), 'preview' (link-preview
// fetchers -- LinkedInBot fetching a post usually means someone shared
// or posted it), 'other' (anything else that says it's a bot).
// Checked in order: the first pattern that matches wins.
const KNOWN_BOTS = [
  { name: 'ChatGPT (search)', category: 'ai', pattern: /OAI-SearchBot/i },
  { name: 'ChatGPT (user)', category: 'ai', pattern: /ChatGPT-User/i },
  { name: 'GPTBot (OpenAI)', category: 'ai', pattern: /GPTBot/i },
  { name: 'Claude (user)', category: 'ai', pattern: /Claude-User/i },
  { name: 'Claude (search)', category: 'ai', pattern: /Claude-SearchBot/i },
  { name: 'ClaudeBot (Anthropic)', category: 'ai', pattern: /ClaudeBot|anthropic-ai|Claude-Web/i },
  { name: 'Perplexity (user)', category: 'ai', pattern: /Perplexity-User/i },
  { name: 'PerplexityBot', category: 'ai', pattern: /PerplexityBot/i },
  { name: 'Google (AI / other crawlers)', category: 'ai', pattern: /GoogleOther|Google-CloudVertexBot/i },
  { name: 'Meta AI', category: 'ai', pattern: /meta-externalagent|meta-externalfetcher/i },
  { name: 'Amazonbot', category: 'ai', pattern: /Amazonbot/i },
  { name: 'Bytespider (ByteDance)', category: 'ai', pattern: /Bytespider/i },
  { name: 'Common Crawl', category: 'ai', pattern: /CCBot/i },
  { name: 'Cohere', category: 'ai', pattern: /cohere-ai|cohere-training/i },
  { name: 'Mistral', category: 'ai', pattern: /MistralAI-User/i },
  { name: 'DuckAssistBot', category: 'ai', pattern: /DuckAssistBot/i },
  { name: 'YouBot', category: 'ai', pattern: /YouBot/i },
  { name: 'DeepSeekBot', category: 'ai', pattern: /DeepSeekBot/i },
  { name: 'Diffbot', category: 'ai', pattern: /Diffbot/i },

  // Apple's iMessage preview claims to be Facebook and Twitter as well,
  // so it has to be checked before either of them.
  { name: 'iMessage', category: 'preview', pattern: /facebookexternalhit.*Facebot.*Twitterbot/i },
  { name: 'LinkedIn', category: 'preview', pattern: /LinkedInBot/i },
  { name: 'Facebook', category: 'preview', pattern: /facebookexternalhit|facebookcatalog/i },
  { name: 'X (Twitter)', category: 'preview', pattern: /Twitterbot/i },
  { name: 'Slack', category: 'preview', pattern: /Slackbot|Slack-ImgProxy/i },
  { name: 'Microsoft Teams / Skype', category: 'preview', pattern: /SkypeUriPreview|MicrosoftPreview/i },
  { name: 'Discord', category: 'preview', pattern: /Discordbot/i },
  { name: 'WhatsApp', category: 'preview', pattern: /WhatsApp/i },
  { name: 'Telegram', category: 'preview', pattern: /TelegramBot/i },
  { name: 'Reddit', category: 'preview', pattern: /redditbot/i },
  { name: 'Pinterest', category: 'preview', pattern: /Pinterestbot/i },
  { name: 'Bluesky', category: 'preview', pattern: /Bluesky|Cardyb/i },
  { name: 'Embedly / Iframely', category: 'preview', pattern: /Embedly|Iframely/i },

  { name: 'Googlebot', category: 'search', pattern: /Googlebot|Google-InspectionTool|Storebot-Google|AdsBot-Google/i },
  { name: 'Bingbot', category: 'search', pattern: /bingbot|BingPreview|msnbot/i },
  { name: 'DuckDuckBot', category: 'search', pattern: /DuckDuckBot/i },
  { name: 'Yahoo Slurp', category: 'search', pattern: /Slurp/i },
  { name: 'YandexBot', category: 'search', pattern: /YandexBot|YandexAccessibilityBot/i },
  { name: 'Baiduspider', category: 'search', pattern: /Baiduspider/i },
  { name: 'Brave Search', category: 'search', pattern: /Bravebot/i },
  { name: 'Applebot (Siri / Spotlight)', category: 'search', pattern: /Applebot/i },
  { name: 'Ahrefs / Semrush (SEO tools)', category: 'search', pattern: /AhrefsBot|SemrushBot|MJ12bot|DotBot/i },
]

// `\bbot\b` rather than `bot\b`: some phone models end in "bot" (Cubot).
const GENERIC_BOT = /\bbot\b|bot\/|crawler|spider|crawl|scraper|headless|python-requests|curl\/|wget|go-http-client|okhttp|axios|node-fetch/i

// { name, category } for a bot, or null for what looks like a person's
// browser.
export function classifyBot(userAgent) {
  const ua = userAgent ?? ''
  if (!ua.trim()) return { name: 'No user agent', category: 'other' }
  for (const bot of KNOWN_BOTS) {
    if (bot.pattern.test(ua)) return { name: bot.name, category: bot.category }
  }
  if (GENERIC_BOT.test(ua)) {
    const named = ua.match(/([A-Za-z][\w.-]*(?:bot|crawler|spider))/i)?.[1]
    return { name: (named ?? 'Unidentified bot').slice(0, 60), category: 'other' }
  }
  return null
}

export const BOT_CATEGORIES = {
  ai: 'AI crawler / assistant',
  search: 'Search engine',
  preview: 'Link preview',
  other: 'Other bot',
}
