import { describe, expect, it } from 'vitest'
import {
  linkedinTextLength,
  plainTextToEditorHTML,
  serializeToLinkedInText,
} from '../../src/lib/linkedinTextFormat.js'

// A fake Tiptap editor -- serializeToLinkedInText only ever calls
// getJSON(), so that's the only surface these tests need to fake.
// `doc(...)` takes raw block nodes directly for anything beyond simple
// paragraphs; `run(text, ...markTypes)` and `para(...runs)` build the
// common case (a paragraph of marked text runs) without the
// boilerplate.
function editor(...blocks) {
  return { getJSON: () => ({ content: blocks }) }
}

function run(text, ...markTypes) {
  return { type: 'text', text, marks: markTypes.map((type) => ({ type })) }
}

function linkRun(text, href) {
  return { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }
}

function para(...runs) {
  return { type: 'paragraph', content: runs }
}

describe('serializeToLinkedInText: plain text and paragraphs', () => {
  it('leaves plain text untouched', () => {
    expect(serializeToLinkedInText(editor(para(run('Shipping v2 today'))))).toBe('Shipping v2 today')
  })

  it('joins paragraphs with a single newline, so an empty paragraph becomes a real blank line', () => {
    const out = serializeToLinkedInText(editor(para(run('first')), { type: 'paragraph', content: [] }, para(run('third'))))
    expect(out).toBe('first\n\nthird')
  })

  it('joins multiple text runs within one paragraph, only styling the marked run', () => {
    const out = serializeToLinkedInText(editor(para(run('plain '), run('bold', 'bold'), run(' plain'))))
    expect(out.startsWith('plain ')).toBe(true)
    expect(out.endsWith(' plain')).toBe(true)
    expect(out).not.toContain('bold') // the word itself was replaced by its bold substitute
  })
})

// Real bold/italic on LinkedIn's own post text is produced by swapping
// in look-alike characters from Unicode's Mathematical Alphanumeric
// Symbols block -- LinkedIn has no markup for it. These are the
// documented block offsets (U+1D400 bold upper, U+1D41A bold lower,
// U+1D7CE bold digit, U+1D434 italic upper, U+1D44E italic lower),
// asserted directly rather than against pasted glyphs, which are too
// easy to mistype in a way that looks right but isn't.
describe('serializeToLinkedInText: bold/italic Unicode substitution', () => {
  it('substitutes bold letters and digits from their documented Unicode block', () => {
    const out = serializeToLinkedInText(editor(para(run('AZ az 09', 'bold'))))
    const codes = [...out].map((c) => c.codePointAt(0))
    expect(codes).toEqual([0x1d400, 0x1d419, 0x20, 0x1d41a, 0x1d433, 0x20, 0x1d7ce, 0x1d7d7])
  })

  it('substitutes italic letters, but leaves digits plain (no math-italic digit block exists)', () => {
    const out = serializeToLinkedInText(editor(para(run('Aa 9', 'italic'))))
    expect([...out].map((c) => c.codePointAt(0))).toEqual([0x1d434, 0x1d44e, 0x20, 0x39])
  })

  it("maps italic lowercase 'h' to the Planck constant symbol, Unicode's one documented gap in that block", () => {
    const out = serializeToLinkedInText(editor(para(run('gh', 'italic'))))
    expect([...out].map((c) => c.codePointAt(0))).toEqual([0x1d454, 0x210e])
  })

  it('uses the bold-italic block when both marks are active, and falls back to plain for a digit (no such block)', () => {
    const out = serializeToLinkedInText(editor(para(run('A5', 'bold', 'italic'))))
    expect([...out].map((c) => c.codePointAt(0))).toEqual([0x1d468, 0x35])
  })

  it('never substitutes punctuation, spaces, or emoji -- only letters and digits', () => {
    expect(serializeToLinkedInText(editor(para(run('*_#[]() 🚀', 'bold'))))).toBe('*_#[]() 🚀')
  })
})

describe('serializeToLinkedInText: underline', () => {
  it('stacks a combining low line after each character -- the best-effort equivalent, since no Unicode block renders underline the way bold/italic do', () => {
    const out = serializeToLinkedInText(editor(para(run('ab', 'underline'))))
    expect(out).toBe('a̲b̲')
  })
})

describe('serializeToLinkedInText: inline code and links', () => {
  it('wraps inline code in backticks', () => {
    expect(serializeToLinkedInText(editor(para(run('npm test', 'code'))))).toBe('`npm test`')
  })

  it('leaves a link alone when its text is just the bare URL, since LinkedIn auto-links plain URLs', () => {
    const url = 'https://example.com'
    expect(serializeToLinkedInText(editor(para(linkRun(url, url))))).toBe(url)
  })

  it('shows both the label and the URL when they differ, using ": " rather than parentheses', () => {
    const out = serializeToLinkedInText(editor(para(linkRun('the docs', 'https://example.com/docs'))))
    expect(out).toBe('the docs: https://example.com/docs')
  })
})

describe('serializeToLinkedInText: headings', () => {
  it('renders a heading as bold text, the closest LinkedIn can actually show', () => {
    const out = serializeToLinkedInText(editor({ type: 'heading', attrs: { level: 2 }, content: [run('Big News')] }))
    expect([...out].map((c) => c.codePointAt(0))[0]).toBe(0x1d401) // bold 'B'
  })

  it('keeps italic on top of the forced bold for a marked run inside a heading', () => {
    const out = serializeToLinkedInText(editor({ type: 'heading', attrs: { level: 1 }, content: [run('Hi', 'italic')] }))
    // Bold-italic upper 'H': block base (0x1d468, 'A') + 7, since 'H' is
    // the 8th letter.
    expect([...out].map((c) => c.codePointAt(0))[0]).toBe(0x1d468 + 7)
  })
})

describe('serializeToLinkedInText: lists', () => {
  it('prefixes bullet list items with a bullet character, not an asterisk or dash LinkedIn might escape', () => {
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [para(run('first'))] }, { type: 'listItem', content: [para(run('second'))] }],
    }
    expect(serializeToLinkedInText(editor(list))).toBe('• first\n• second')
  })

  it('numbers ordered list items starting from 1 by default, or attrs.start when given', () => {
    const list = {
      type: 'orderedList',
      attrs: { start: 3 },
      content: [{ type: 'listItem', content: [para(run('a'))] }, { type: 'listItem', content: [para(run('b'))] }],
    }
    expect(serializeToLinkedInText(editor(list))).toBe('3. a\n4. b')
  })

  it('indents a second paragraph inside one list item under its marker instead of repeating it', () => {
    const list = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [para(run('first line')), para(run('second line'))] }],
    }
    expect(serializeToLinkedInText(editor(list))).toBe('• first line\n  second line')
  })
})

describe('serializeToLinkedInText: blockquote and callout', () => {
  it('indents a blockquote instead of using ">" -- one of the characters LinkedIn escapes to a literal backslash', () => {
    const out = serializeToLinkedInText(editor({ type: 'blockquote', content: [para(run('quoted'))] }))
    expect(out).toBe('  quoted')
    expect(out).not.toContain('>')
  })

  it('treats a callout the same way as a blockquote', () => {
    const out = serializeToLinkedInText(editor({ type: 'callout', content: [para(run('heads up'))] }))
    expect(out).toBe('  heads up')
  })
})

describe('serializeToLinkedInText: code blocks', () => {
  it('wraps a code block in a triple-backtick fence and preserves internal line breaks', () => {
    const codeBlock = { type: 'codeBlock', content: [{ type: 'text', text: 'line one\nline two' }] }
    expect(serializeToLinkedInText(editor(codeBlock))).toBe('```\nline one\nline two\n```')
  })
})

describe('serializeToLinkedInText: images and video embeds', () => {
  it('includes an inserted image as its own line, since there is no real "attached image" equivalent through post text', () => {
    const image = { type: 'image', attrs: { src: 'https://example.com/pic.png' } }
    expect(serializeToLinkedInText(editor(image))).toBe('https://example.com/pic.png')
  })

  it('reconstructs a youtube.com watch link from a youtube embed node', () => {
    const embed = { type: 'youtubeEmbed', attrs: { videoId: 'dQw4w9WgXcQ' } }
    expect(serializeToLinkedInText(editor(embed))).toBe('https://youtu.be/dQw4w9WgXcQ')
  })
})

describe('no generated structure ever uses a character LinkedIn escapes to a backslash', () => {
  // supabase/functions/_shared/linkedin.ts's escapeCommentary backslash-
  // escapes \|{}@[]()<>*_~ before posting -- if any marker this module
  // generates were one of those, it would come back from LinkedIn with
  // a literal backslash glued to it. Bold/italic substitution is exempt
  // (those characters are real Unicode letters, not ASCII punctuation).
  const RESERVED = /[\\|{}@[\]()<>*_~]/

  it('bullets, numbering, blockquote indent, and code fences are all clean', () => {
    const doc = editor(
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(run('x'))] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(run('x'))] }] },
      { type: 'blockquote', content: [para(run('x'))] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
    )
    const out = serializeToLinkedInText(doc)
    const withoutContent = out.replaceAll('x', '')
    expect(withoutContent).not.toMatch(RESERVED)
  })

  it("a link with differing text/href uses a separator that isn't reserved", () => {
    const out = serializeToLinkedInText(editor(para(linkRun('label', 'https://example.com'))))
    expect(out.replace('https://example.com', '')).not.toMatch(RESERVED)
  })
})

describe('plainTextToEditorHTML / serializeToLinkedInText round trip', () => {
  it('round-trips plain multi-line text unchanged', () => {
    const original = 'line one\n\nline three'
    const doc = { getJSON: () => htmlLinesToDoc(plainTextToEditorHTML(original)) }
    expect(serializeToLinkedInText(doc)).toBe(original)
  })

  it('escapes HTML-significant characters so they load as literal text, not markup', () => {
    const html = plainTextToEditorHTML('<b>&amp;</b>')
    expect(html).not.toContain('<b>&amp;</b>'.slice(0, 3)) // the raw "<b>" must not appear unescaped
    expect(html).toContain('&lt;b&gt;')
  })
})

// Mimics just enough of Tiptap's own HTML->JSON parsing (one <p> per
// line) to round-trip plainTextToEditorHTML's output back through
// serializeToLinkedInText without pulling in a real editor instance.
function htmlLinesToDoc(html) {
  const lines = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1])
  return {
    content: lines.map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') }] : [],
    })),
  }
}

describe('linkedinTextLength', () => {
  it('counts plain ASCII the same as .length', () => {
    expect(linkedinTextLength('hello')).toBe(5)
  })

  it('counts a bold-substituted character as 1, not 2 -- the whole reason this function exists', () => {
    const bold = serializeToLinkedInText(editor(para(run('AB', 'bold'))))
    // The point being tested: naive .length double-counts these
    // (they're outside the Basic Multilingual Plane, so JS strings
    // store each one as a surrogate pair), which would silently let a
    // message through this UI's own limit check with room to spare, or
    // reject one that's actually still within LinkedIn's real limit.
    expect(bold.length).toBe(4)
    expect(linkedinTextLength(bold)).toBe(2)
  })

  it('counts an emoji as 1 character too', () => {
    expect(linkedinTextLength('🚀')).toBe(1)
  })
})
