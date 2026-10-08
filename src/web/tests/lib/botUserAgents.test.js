import { describe, expect, it } from 'vitest'
import { classifyBot } from '../../src/lib/botUserAgents.js'

// Real user-agent strings, as each sends them.
const bots = {
  'GPTBot (OpenAI)':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot',
  'ChatGPT (user)': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  'ChatGPT (search)':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  'ClaudeBot (Anthropic)':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Claude (user)': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  PerplexityBot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'Common Crawl': 'CCBot/2.0 (https://commoncrawl.org/faq/)',
  'Meta AI': 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
}
const previews = {
  LinkedIn: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  Facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'X (Twitter)': 'Twitterbot/1.0',
  Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  iMessage:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
}
const search = {
  Googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Applebot (Siri / Spotlight)':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  DuckDuckBot: 'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
}

// People, including apps' built-in browsers that mention the app's name.
const people = {
  'Chrome on Windows':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Safari on iPhone':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'LinkedIn app’s browser':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]',
  'Facebook app’s browser':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]',
  'Teams desktop':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Teams/1.6.00.4472 Chrome/120.0.0.0 Electron/28.0.0 Safari/537.36',
  'A Cubot phone':
    'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
}

describe('classifyBot', () => {
  it.each(Object.entries(bots))('recognises %s as an AI crawler or assistant', (name, ua) => {
    expect(classifyBot(ua)).toEqual({ name, category: 'ai' })
  })

  it.each(Object.entries(previews))('recognises %s as a link preview', (name, ua) => {
    expect(classifyBot(ua)).toEqual({ name, category: 'preview' })
  })

  it.each(Object.entries(search))('recognises %s as a search engine', (name, ua) => {
    expect(classifyBot(ua)).toEqual({ name, category: 'search' })
  })

  it.each(Object.entries(people))('treats %s as a person, not a bot', (_, ua) => {
    expect(classifyBot(ua)).toBeNull()
  })

  it('names an unknown bot by the "...bot" token in its user agent', () => {
    expect(classifyBot('Mozilla/5.0 (compatible; SomeNewAIBot/2.0; +https://example.com/bot)')).toEqual({
      name: 'SomeNewAIBot',
      category: 'other',
    })
  })

  it('counts scripts and command-line tools as other bots', () => {
    expect(classifyBot('curl/8.4.0')).toEqual({ name: 'Unidentified bot', category: 'other' })
    expect(classifyBot('python-requests/2.32.0')).toEqual({ name: 'Unidentified bot', category: 'other' })
  })

  it('counts a request with no user agent at all as a bot', () => {
    expect(classifyBot('')).toEqual({ name: 'No user agent', category: 'other' })
    expect(classifyBot(undefined)).toEqual({ name: 'No user agent', category: 'other' })
  })
})
