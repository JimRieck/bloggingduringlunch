import DOMPurify from 'dompurify'

// Turns the post editor's HTML into an email that renders properly in
// mail apps, plus a plain-text version. Mail apps ignore most
// stylesheets, so every element gets its styles inline; a YouTube embed
// (an empty placeholder div in the editor's HTML) becomes a clickable
// thumbnail, since email can't play video. Runs in the browser whenever
// an announcement draft is saved -- the result is what gets sent.
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = 'SFMono-Regular, Menlo, Consolas, monospace'
const ACCENT = '#7c3aed'

const TAG_STYLES = {
  p: 'margin:0 0 16px;',
  h1: 'margin:24px 0 12px;font-size:26px;line-height:1.3;color:#111;',
  h2: 'margin:24px 0 10px;font-size:22px;line-height:1.3;color:#111;',
  h3: 'margin:20px 0 8px;font-size:18px;line-height:1.3;color:#111;',
  ul: 'margin:0 0 16px;padding-left:24px;',
  ol: 'margin:0 0 16px;padding-left:24px;',
  li: 'margin:0 0 6px;',
  blockquote: 'margin:0 0 16px;padding:0 0 0 14px;border-left:3px solid #d4d4dc;color:#555;',
  pre: `margin:0 0 16px;padding:12px 14px;background:#f4f4f6;border-radius:4px;font-family:${MONO};font-size:13px;white-space:pre-wrap;word-break:break-word;`,
  code: `font-family:${MONO};font-size:14px;background:#f4f4f6;padding:2px 5px;border-radius:3px;`,
  a: `color:${ACCENT};`,
  img: 'max-width:100%;height:auto;border-radius:4px;',
}
const CALLOUT_STYLE = `margin:0 0 16px;padding:14px 16px;border-left:3px solid ${ACCENT};background:#f3effd;border-radius:4px;`

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function youtubeLink(videoId) {
  const wrapper = document.createElement('p')
  const link = document.createElement('a')
  link.href = `https://www.youtube.com/watch?v=${videoId}`
  const thumbnail = document.createElement('img')
  thumbnail.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  thumbnail.alt = 'Watch the video on YouTube'
  thumbnail.width = 560
  link.appendChild(thumbnail)
  wrapper.appendChild(link)
  const caption = document.createElement('p')
  const captionLink = document.createElement('a')
  captionLink.href = link.href
  captionLink.textContent = '▶ Watch the video on YouTube'
  caption.appendChild(captionLink)
  return [wrapper, caption]
}

// A link's text, plus its address when that isn't already the text.
function inlineText(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent
  if (node.nodeName === 'BR') return '\n'
  if (node.nodeName === 'IMG') return ''
  const inner = [...node.childNodes].map(inlineText).join('')
  if (node.nodeName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (!inner.trim()) return href
    return inner.trim() === href ? href : `${inner} (${href})`
  }
  return inner
}

function blockText(el) {
  switch (el.nodeName) {
    case 'UL':
      return [...el.children].map((li) => `• ${blockLines(li)}`).join('\n')
    case 'OL':
      return [...el.children].map((li, i) => `${i + 1}. ${blockLines(li)}`).join('\n')
    case 'BLOCKQUOTE':
      return blockLines(el)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'PRE':
      return el.textContent
    case 'DIV':
      return blockLines(el)
    default:
      return inlineText(el).trim()
  }
}

function blockLines(container) {
  const blocks = [...container.childNodes]
    .map((node) => (node.nodeType === Node.ELEMENT_NODE ? blockText(node) : node.textContent.trim()))
    .filter(Boolean)
  return blocks.join(container.nodeName === 'LI' ? '\n  ' : '\n\n')
}

export function buildAnnouncementEmail({ subject, bodyHtml, siteUrl }) {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(bodyHtml ?? '')
  const root = template.content
  // The plain-text version is built from its own copy: there, a video is
  // just the caption link -- the thumbnail would repeat the same URL.
  const textRoot = root.cloneNode(true)

  for (const [fragment, includeThumbnail] of [
    [root, true],
    [textRoot, false],
  ]) {
    for (const placeholder of fragment.querySelectorAll('[data-type="youtube-embed"]')) {
      const videoId = placeholder.getAttribute('data-video-id')
      if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
        const [thumbnail, caption] = youtubeLink(videoId)
        placeholder.replaceWith(...(includeThumbnail ? [thumbnail, caption] : [caption]))
      } else {
        placeholder.remove()
      }
    }
  }
  for (const callout of root.querySelectorAll('[data-type="callout"]')) {
    callout.setAttribute('style', CALLOUT_STYLE)
  }
  for (const [tag, style] of Object.entries(TAG_STYLES)) {
    for (const el of root.querySelectorAll(tag)) {
      if (tag === 'code' && el.closest('pre')) continue
      el.setAttribute('style', style)
    }
  }
  // The editor always keeps an empty paragraph at the end.
  while (root.lastElementChild?.nodeName === 'P' && !root.lastElementChild.textContent.trim() && !root.lastElementChild.querySelector('img')) {
    root.lastElementChild.remove()
  }

  const holder = document.createElement('div')
  holder.appendChild(root.cloneNode(true))
  const bodyMarkup = holder.innerHTML
  const footer = `You're getting this because you have an account at Blogging During Lunch.`

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject ?? '')}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f6;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td style="padding:24px 28px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${ACCENT};">Blogging During Lunch</td></tr>
<tr><td style="padding:16px 28px 12px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1f1f24;">${bodyMarkup}</td></tr>
</table>
<p style="max-width:600px;margin:16px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#777;">${escapeHtml(footer)} <a href="${escapeHtml(siteUrl)}" style="color:#777;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a></p>
</td></tr>
</table>
</body>
</html>`

  const text = `${blockLines(textRoot)}\n\n--\n${footer}\n${siteUrl}\n`
  return { html, text }
}
