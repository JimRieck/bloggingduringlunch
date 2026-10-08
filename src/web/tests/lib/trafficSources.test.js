import { describe, expect, it } from 'vitest'
import { classifySource, summarizeSources } from '../../src/lib/trafficSources.js'

const from = (referrerHost, utmSource = null) => classifySource({ referrerHost, utmSource })

describe('classifySource', () => {
  it.each([
    ['www.linkedin.com', 'LinkedIn', 'social'],
    ['lnkd.in', 'LinkedIn', 'social'],
    ['l.facebook.com', 'Facebook', 'social'],
    ['t.co', 'X (Twitter)', 'social'],
    ['old.reddit.com', 'Reddit', 'social'],
    ['news.ycombinator.com', 'Hacker News', 'social'],
    ['www.google.com', 'Google', 'search'],
    ['www.google.co.uk', 'Google', 'search'],
    ['www.bing.com', 'Bing', 'search'],
    ['duckduckgo.com', 'DuckDuckGo', 'search'],
    ['chatgpt.com', 'ChatGPT', 'ai'],
    ['chat.openai.com', 'ChatGPT', 'ai'],
    ['www.perplexity.ai', 'Perplexity', 'ai'],
    ['claude.ai', 'Claude', 'ai'],
    ['copilot.microsoft.com', 'Copilot', 'ai'],
    ['gemini.google.com', 'Gemini', 'ai'],
    ['mail.google.com', 'Gmail', 'email'],
    ['outlook.live.com', 'Outlook', 'email'],
    ['bloggingduringlunch.com', 'This site', 'internal'],
    ['ui-test-blog.localhost', 'This site', 'internal'],
  ])('%s -> %s (%s)', (host, name, type) => {
    expect(from(host)).toEqual({ name, type })
  })

  it('names any other website by its domain, without "www."', () => {
    expect(from('www.some-dev-blog.example')).toEqual({ name: 'some-dev-blog.example', type: 'website' })
  })

  it('does not mistake a look-alike domain for a known one', () => {
    expect(from('notlinkedin.com')).toEqual({ name: 'notlinkedin.com', type: 'website' })
    expect(from('google.evil.example')).toEqual({ name: 'google.evil.example', type: 'website' })
  })

  it('treats no referrer as Direct / unknown', () => {
    expect(from(null)).toEqual({ name: 'Direct / unknown', type: 'direct' })
    expect(from('')).toEqual({ name: 'Direct / unknown', type: 'direct' })
  })

  it('a utm_source tag wins over the referrer -- it still says LinkedIn when the app hid the referrer', () => {
    expect(from(null, 'linkedin')).toEqual({ name: 'LinkedIn', type: 'social' })
    expect(from('www.google.com', 'LinkedIn')).toEqual({ name: 'LinkedIn', type: 'social' })
  })

  it('maps email-style tags to Email, and keeps an unknown tag under its own name', () => {
    expect(from(null, 'newsletter')).toEqual({ name: 'Email', type: 'email' })
    expect(from(null, 'spring-conference')).toEqual({ name: 'spring-conference', type: 'tagged' })
  })
})

describe('summarizeSources', () => {
  const rows = [
    { referrer_host: 'www.linkedin.com', utm_source: null, views: 5 },
    { referrer_host: null, utm_source: 'linkedin', views: 3 },
    { referrer_host: 'www.google.com', utm_source: null, views: 4 },
    { referrer_host: 'www.bing.com', utm_source: null, views: 1 },
    { referrer_host: null, utm_source: null, views: 6 },
    { referrer_host: 'chatgpt.com', utm_source: null, views: 1 },
  ]

  it('adds up views per source, combining a referrer and a tag that mean the same place', () => {
    const { total, sources } = summarizeSources(rows)
    expect(total).toBe(20)
    expect(sources).toEqual([
      { name: 'LinkedIn', type: 'social', views: 8 },
      { name: 'Direct / unknown', type: 'direct', views: 6 },
      { name: 'Google', type: 'search', views: 4 },
      { name: 'Bing', type: 'search', views: 1 },
      { name: 'ChatGPT', type: 'ai', views: 1 },
    ])
  })

  it('adds up views per type, busiest first, with display names', () => {
    expect(summarizeSources(rows).types).toEqual([
      { type: 'social', name: 'Social', views: 8 },
      { type: 'direct', name: 'Direct / unknown', views: 6 },
      { type: 'search', name: 'Search', views: 5 },
      { type: 'ai', name: 'AI assistant', views: 1 },
    ])
  })

  it('handles no data', () => {
    expect(summarizeSources([])).toEqual({ total: 0, sources: [], types: [] })
  })
})
