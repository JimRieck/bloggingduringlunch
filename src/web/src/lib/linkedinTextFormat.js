// LinkedIn's Posts API has no bold/italic *markup* for organic post text
// -- the bold/italic text you see in real LinkedIn posts is produced by
// swapping each letter for its look-alike character in Unicode's
// Mathematical Alphanumeric Symbols block, not by wrapping it in any
// kind of tag (that's also why third-party "LinkedIn bold text"
// generators exist at all -- there'd be no need for one if `*text*`
// just worked). This does the same substitution for whatever's marked
// bold/italic in LinkedInMessageEditor.jsx, so it actually renders
// styled once posted, not just in the compose box.
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

function styleRun(text, bold, italic) {
  if (!bold && !italic) return text
  return [...text].map((ch) => styledChar(ch, bold, italic)).join('')
}

// Walks the editor's document directly (paragraphs of text runs, each
// with its own marks) rather than using Tiptap's own getText(), since
// that has no way to know which runs should become styled Unicode text.
export function serializeToLinkedInText(editor) {
  const doc = editor.getJSON()
  const paragraphs = (doc.content ?? []).map((node) => {
    if (node.type !== 'paragraph' || !node.content) return ''
    return node.content
      .map((run) => {
        if (run.type !== 'text') return ''
        const marks = new Set((run.marks ?? []).map((m) => m.type))
        return styleRun(run.text ?? '', marks.has('bold'), marks.has('italic'))
      })
      .join('')
  })
  return paragraphs.join('\n')
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

// The inverse of serializeToLinkedInText's paragraph join, for loading an
// existing plain-text message back into the editor to edit it further.
// Previously-bold/italic text stays as the literal styled Unicode
// characters it already was -- there's no mark to recover since nothing
// but the final text is ever stored, but visually it's still exactly
// what was posted, which is what matters when re-editing.
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
