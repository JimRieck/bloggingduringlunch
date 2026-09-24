// Converts the same rich-text editor document PostForm.jsx uses into
// LinkedIn post text. LinkedIn's Posts API can't represent any of this
// structurally (no headings, lists, quotes, code blocks or embeds in an
// organic post) -- everything here is a plain-text approximation, not a
// real conversion, chosen to (a) look reasonable in a LinkedIn feed and
// (b) never use a character LinkedIn's own "little text format" treats
// as reserved syntax (see supabase/functions/_shared/linkedin.ts's
// escapeCommentary: \ | { } @ [ ] ( ) < > * _ ~ all get backslash-escaped
// before posting). Every marker below -- the bullet, the numbering, the
// blockquote indent, the code fence, the link separator -- was picked
// specifically to avoid that list; using "> " for quotes or "(url)" for
// links, for instance, would come back from LinkedIn with a literal
// backslash in front of it.

// Real bold/italic on LinkedIn's own post text is produced by swapping
// in look-alike characters from Unicode's Mathematical Alphanumeric
// Symbols block -- LinkedIn has no markup for it, which is also why
// third-party "LinkedIn bold text" generators exist at all.
const BOLD_UPPER = 0x1d400
const BOLD_LOWER = 0x1d41a
const BOLD_DIGIT = 0x1d7ce
const ITALIC_UPPER = 0x1d434
const ITALIC_LOWER = 0x1d44e
// Unicode's math-italic block has one documented gap: lowercase italic
// "h" isn't in it (it reuses the pre-existing Planck constant symbol
// instead of assigning a new code point). There's no dedicated
// math-italic digit block at all, so italic-only digits fall back to
// plain digits below -- not a bug, there's genuinely no such character.
const ITALIC_SMALL_H = 0x210e
const BOLD_ITALIC_UPPER = 0x1d468
const BOLD_ITALIC_LOWER = 0x1d482

function styledChar(ch, bold, italic) {
  const code = ch.codePointAt(0)
  const isUpper = code >= 0x41 && code <= 0x5a
  const isLower = code >= 0x61 && code <= 0x7a
  const isDigit = code >= 0x30 && code <= 0x39
  const base = isUpper ? 0x41 : 0x61

  if (bold && italic && (isUpper || isLower)) {
    return String.fromCodePoint((isUpper ? BOLD_ITALIC_UPPER : BOLD_ITALIC_LOWER) + (code - base))
  }
  // !italic on both branches below: with no bold-italic digit block,
  // bold+italic on a digit should fall through to the plain digit at
  // the bottom, not silently apply bold-only styling.
  if (bold && !italic && isDigit) {
    return String.fromCodePoint(BOLD_DIGIT + (code - 0x30))
  }
  if (bold && !italic && (isUpper || isLower)) {
    return String.fromCodePoint((isUpper ? BOLD_UPPER : BOLD_LOWER) + (code - base))
  }
  if (italic && !bold) {
    if (ch === 'h') return String.fromCodePoint(ITALIC_SMALL_H)
    if (isUpper || isLower) return String.fromCodePoint((isUpper ? ITALIC_UPPER : ITALIC_LOWER) + (code - base))
  }
  return ch
}

function boldItalic(text, bold, italic) {
  if (!bold && !italic) return text
  return [...text].map((ch) => styledChar(ch, bold, italic)).join('')
}

// No Unicode block renders an underline the way the bold/italic blocks
// above do -- this is the best-effort alternative real "fancy text"
// tools use instead: a combining low line (U+0332) stacked after every
// character. It's genuinely less universally reliable than the
// substitution above (some renderers, especially on older mobile
// clients, show a broken or disconnected line), which is worth knowing
// if it looks off in an actual post -- but it's a real attempt at the
// effect, not a silent no-op, which is what underline had before.
function underline(text) {
  return [...text].map((ch) => ch + '̲').join('')
}

// One text run (a string plus whatever marks apply to it) -> the exact
// characters that should appear in the LinkedIn post. `forceBold` is
// for headings, which have no Unicode "heading" equivalent -- bold is
// the closest thing LinkedIn can actually display, applied on top of
// whatever marks the run already carries (so italic text inside a
// heading still renders bold+italic, not italic-only).
function styleText(text, marks, forceBold = false) {
  const types = new Set(marks.map((m) => m.type))
  let out = boldItalic(text, forceBold || types.has('bold'), types.has('italic'))
  if (types.has('code')) out = '`' + out + '`'
  if (types.has('underline')) out = underline(out)
  const link = marks.find((m) => m.type === 'link')
  if (link?.attrs?.href) {
    // LinkedIn auto-links a bare URL in post text; a link whose visible
    // text differs from its href has no organic-post equivalent for
    // "clickable text, different URL underneath", so both are shown --
    // ": " rather than the more obvious "(url)", since "(" and ")" are
    // two of the characters LinkedIn's escaping would otherwise mangle.
    out = out.trim() === link.attrs.href.trim() ? link.attrs.href : `${out}: ${link.attrs.href}`
  }
  return out
}

function runsText(content, forceBold = false) {
  return (content ?? [])
    .map((run) => (run.type === 'text' ? styleText(run.text ?? '', run.marks ?? [], forceBold) : ''))
    .join('')
}

function prefixLines(lines, prefix) {
  return lines.length ? lines.map((line) => prefix + line) : [prefix.trimEnd()]
}

// A listItem's own content is block nodes (almost always one
// paragraph, occasionally a nested list) -- only the first resulting
// line gets the bullet/number, the rest (a second paragraph, or a
// nested list's own lines) are indented under it instead of repeating
// the marker.
function listItemLines(item, marker) {
  const inner = (item.content ?? []).flatMap(blockToLines)
  if (inner.length === 0) return [marker.trimEnd()]
  return [marker + inner[0], ...inner.slice(1).map((line) => '  ' + line)]
}

// One block-level node -> the output lines it becomes. Returns an
// array (not a joined string) so a container like blockquote/callout
// or a list item can prefix or indent each inner line independently.
function blockToLines(node) {
  switch (node.type) {
    case 'paragraph':
      return [runsText(node.content)]
    case 'heading':
      return [runsText(node.content, true)]
    case 'blockquote':
    case 'callout':
      // Indentation only, deliberately -- the obvious marker character
      // for a quote is ">", which is one of the characters LinkedIn's
      // escaping would turn into a literal "\>".
      return prefixLines((node.content ?? []).flatMap(blockToLines), '  ')
    case 'bulletList':
      return (node.content ?? []).flatMap((item) => listItemLines(item, '• '))
    case 'orderedList': {
      let n = node.attrs?.start ?? 1
      return (node.content ?? []).flatMap((item) => {
        const lines = listItemLines(item, `${n}. `)
        n += 1
        return lines
      })
    }
    case 'codeBlock': {
      const raw = (node.content ?? []).map((run) => run.text ?? '').join('')
      return ['```', ...raw.split('\n'), '```']
    }
    case 'image':
      // No organic-post equivalent of a real attached image exists
      // through what this editor can do (LinkedIn's actual Images API
      // is a separate multi-step upload, not part of post text) -- the
      // URL is included as plain text so nothing is silently dropped;
      // LinkedIn will attempt to unfurl it as a link preview.
      return node.attrs?.src ? [node.attrs.src] : []
    case 'youtubeEmbed':
      return node.attrs?.videoId ? [`https://youtu.be/${node.attrs.videoId}`] : []
    default:
      return []
  }
}

export function serializeToLinkedInText(editor) {
  const doc = editor.getJSON()
  const lines = (doc.content ?? []).flatMap(blockToLines)
  return lines.join('\n')
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

// The inverse of serializeToLinkedInText's line join, for loading an
// existing plain-text message back into the editor to edit it further.
// This only ever recovers plain paragraphs, not the original
// headings/lists/quotes/bold marks -- there's nothing to recover them
// from, since only the final flattened text is ever stored. Previously
// bold/italic/underlined text stays exactly the Unicode characters it
// already was, which is still visually correct even without the mark.
export function plainTextToEditorHTML(text) {
  return (text ?? '')
    .split('\n')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

// LinkedIn (and this editor's own character counter) count by Unicode
// code point, not UTF-16 code units -- the bold/italic substitutes above
// live outside the Basic Multilingual Plane, so a plain `.length` would
// count each one as 2 and make the count wrong exactly when it matters
// most (a message that's actually at the limit).
export function linkedinTextLength(text) {
  return [...(text ?? '')].length
}
