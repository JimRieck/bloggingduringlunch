import { describe, expect, it } from 'vitest'
import {
  linkedinTextLength,
  plainTextToEditorHTML,
  serializeToLinkedInText,
} from '../../src/lib/linkedinTextFormat.js'

// A fake Tiptap editor -- serializeToLinkedInText only ever calls
// getJSON(), so that's the only surface these tests need to fake.
function editorWithParagraphs(...paragraphs) {
  return {
    getJSON: () => ({
      content: paragraphs.map((runs) => ({
        type: 'paragraph',
        content: runs.map(([text, ...marks]) => ({
          type: 'text',
          text,
          marks: marks.map((type) => ({ type })),
        })),
      })),
    }),
  }
}

describe('serializeToLinkedInText', () => {
  it('leaves plain text untouched', () => {
    const editor = editorWithParagraphs([['Shipping v2 today']])
    expect(serializeToLinkedInText(editor)).toBe('Shipping v2 today')
  })

  // Real bold/italic on LinkedIn's own post text is produced by
  // swapping in look-alike characters from Unicode's Mathematical
  // Alphanumeric Symbols block -- LinkedIn has no markup for it. These
  // are the documented block offsets (U+1D400 bold upper, U+1D41A bold
  // lower, U+1D7CE bold digit, U+1D434 italic upper, U+1D44E italic
  // lower), asserted directly rather than against pasted glyphs, which
  // are too easy to mistype in a way that looks right but isn't.
  it('substitutes bold letters and digits from their documented Unicode block', () => {
    const editor = editorWithParagraphs([['AZ az 09', 'bold']])
    const out = serializeToLinkedInText(editor)
    const codes = [...out].map((c) => c.codePointAt(0))
    expect(codes).toEqual([
      0x1d400, // A
      0x1d419, // Z
      0x20, // space
      0x1d41a, // a
      0x1d433, // z
      0x20, // space
      0x1d7ce, // 0
      0x1d7d7, // 9
    ])
  })

  it('substitutes italic letters, but leaves digits plain (no math-italic digit block exists)', () => {
    const editor = editorWithParagraphs([['Aa 9', 'italic']])
    const out = serializeToLinkedInText(editor)
    const codes = [...out].map((c) => c.codePointAt(0))
    expect(codes).toEqual([0x1d434, 0x1d44e, 0x20, 0x39])
  })

  it("maps italic lowercase 'h' to the Planck constant symbol, Unicode's one documented gap in that block", () => {
    const editor = editorWithParagraphs([['gh', 'italic']])
    const out = serializeToLinkedInText(editor)
    expect([...out].map((c) => c.codePointAt(0))).toEqual([0x1d454, 0x210e])
  })

  it('uses the bold-italic block when both marks are active, and falls back to plain for a digit (no such block)', () => {
    const editor = editorWithParagraphs([['A5', 'bold', 'italic']])
    const out = serializeToLinkedInText(editor)
    expect([...out].map((c) => c.codePointAt(0))).toEqual([0x1d468, 0x35])
  })

  it('never substitutes punctuation, spaces, or emoji -- only letters and digits', () => {
    const editor = editorWithParagraphs([['*_#[]() 🚀', 'bold']])
    expect(serializeToLinkedInText(editor)).toBe('*_#[]() 🚀')
  })

  it('joins multiple text runs within one paragraph, only styling the marked run', () => {
    const editor = editorWithParagraphs([['plain '], ['bold', 'bold'], [' plain']])
    const out = serializeToLinkedInText(editor)
    expect(out.startsWith('plain ')).toBe(true)
    expect(out.endsWith(' plain')).toBe(true)
    expect(out).not.toContain('bold') // the word itself was replaced by its bold substitute
  })

  it('joins paragraphs with a single newline, so an empty paragraph becomes a real blank line', () => {
    const editor = editorWithParagraphs([['first']], [], [['third']])
    expect(serializeToLinkedInText(editor)).toBe('first\n\nthird')
  })
})

describe('plainTextToEditorHTML / serializeToLinkedInText round trip', () => {
  it('round-trips plain multi-line text unchanged', () => {
    const original = 'line one\n\nline three'
    const editor = { getJSON: () => htmlLinesToDoc(plainTextToEditorHTML(original)) }
    expect(serializeToLinkedInText(editor)).toBe(original)
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
    const editor = editorWithParagraphs([['AB', 'bold']])
    const bold = serializeToLinkedInText(editor)
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
