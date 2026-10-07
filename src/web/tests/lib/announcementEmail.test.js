// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildAnnouncementEmail } from '../../src/lib/announcementEmail.js'

const siteUrl = 'https://bloggingduringlunch.com'

function build(bodyHtml, subject = 'New feature') {
  return buildAnnouncementEmail({ subject, bodyHtml, siteUrl })
}

// The message part of the email, parsed, for querying.
function body(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelectorAll('td')[2]
}

describe('buildAnnouncementEmail: html', () => {
  it('is a complete email document with the subject as its title', () => {
    const { html } = build('<p>Hi</p>', 'Say hello to <Preview>')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<title>Say hello to &lt;Preview&gt;</title>')
  })

  it('keeps the formatting and puts every style inline, since mail apps drop stylesheets', () => {
    const message = body(build('<h2>Big news</h2><p>Some <strong>bold</strong> and <a href="https://x.dev">a link</a></p>').html)
    expect(message.querySelector('h2').getAttribute('style')).toContain('font-size:22px')
    expect(message.querySelector('p').getAttribute('style')).toContain('margin:0 0 16px')
    expect(message.querySelector('strong').textContent).toBe('bold')
    expect(message.querySelector('a').getAttribute('style')).toContain('color:')
  })

  it('styles inline code but leaves code inside a code block to the block', () => {
    const message = body(build('<p><code>npm test</code></p><pre><code>line 1</code></pre>').html)
    expect(message.querySelector('p code').getAttribute('style')).toContain('font-family')
    expect(message.querySelector('pre code').hasAttribute('style')).toBe(false)
    expect(message.querySelector('pre').getAttribute('style')).toContain('white-space:pre-wrap')
  })

  it('gives a callout its box styling inline', () => {
    const message = body(build('<div data-type="callout" class="callout"><p>Heads up</p></div>').html)
    expect(message.querySelector('[data-type="callout"]').getAttribute('style')).toContain('border-left')
  })

  it('turns a YouTube embed into a clickable thumbnail plus a text link', () => {
    const message = body(build('<div data-type="youtube-embed" data-video-id="dQw4w9WgXcQ"></div>').html)
    const links = [...message.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual([
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ])
    expect(message.querySelector('img').getAttribute('src')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(message.querySelector('[data-type="youtube-embed"]')).toBeNull()
  })

  it('drops an embed with a malformed video id instead of building a link from it', () => {
    const message = body(build('<p>Before</p><div data-type="youtube-embed" data-video-id="../evil"></div>').html)
    expect(message.querySelector('a')).toBeNull()
  })

  it('strips scripts and event handlers', () => {
    const { html } = build('<p onclick="steal()">Hi</p><script>steal()</script>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onclick')
  })

  it("drops the editor's trailing empty paragraph", () => {
    const message = body(build('<p>Only line</p><p></p>').html)
    expect(message.querySelectorAll('p')).toHaveLength(1)
  })

  it('ends with a footer saying why the reader got it, linking to the site', () => {
    const { html } = build('<p>Hi</p>')
    expect(html).toContain('because you have an account at Blogging During Lunch')
    expect(html).toContain(`href="${siteUrl}"`)
  })
})

describe('buildAnnouncementEmail: plain-text version', () => {
  it('keeps paragraphs and headings as separate blocks', () => {
    expect(build('<h2>Big news</h2><p>First</p><p>Second</p>').text.startsWith('Big news\n\nFirst\n\nSecond\n\n--\n')).toBe(true)
  })

  it('writes lists as bullets and numbers', () => {
    const { text } = build('<ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>a</p></li><li><p>b</p></li></ol>')
    expect(text).toContain('• one\n• two')
    expect(text).toContain('1. a\n2. b')
  })

  it('shows a link’s address after its text, but not twice when the text is the address', () => {
    const { text } = build('<p><a href="https://x.dev/docs">the docs</a> or <a href="https://x.dev">https://x.dev</a></p>')
    expect(text).toContain('the docs (https://x.dev/docs) or https://x.dev')
  })

  it('quotes a blockquote and includes the YouTube link', () => {
    const { text } = build('<blockquote><p>Quoted</p></blockquote><div data-type="youtube-embed" data-video-id="dQw4w9WgXcQ"></div>')
    expect(text).toContain('> Quoted')
    expect(text).toContain('▶ Watch the video on YouTube (https://www.youtube.com/watch?v=dQw4w9WgXcQ)')
  })

  it('mentions the video link once, not again for the thumbnail', () => {
    const { text } = build('<div data-type="youtube-embed" data-video-id="dQw4w9WgXcQ"></div>')
    expect(text.match(/watch\?v=dQw4w9WgXcQ/g)).toHaveLength(1)
  })

  it('ends with the same footer', () => {
    expect(build('<p>Hi</p>').text).toContain(`because you have an account at Blogging During Lunch.\n${siteUrl}`)
  })
})
