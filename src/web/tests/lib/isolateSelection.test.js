// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { postEditorExtensions } from '../../src/lib/postEditorExtensions.js'
import { TOOLBAR_BUTTONS } from '../../src/lib/richTextToolbar.js'

// A real editor with the post editor's extensions, driven through the
// toolbar's own button definitions -- the same code a click runs.
let editor

afterEach(() => editor?.destroy())

function editorWith(content) {
  editor = new Editor({ element: document.createElement('div'), extensions: postEditorExtensions(), content })
  return editor
}

// Highlights the first occurrence of `text`, which may cross formatting
// and paragraph boundaries -- like dragging the mouse over it.
function highlight(text) {
  const positions = []
  let flat = ''
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text.length; i++) positions.push(pos + i)
      flat += node.text
    } else if (node.type.name === 'hardBreak') {
      positions.push(pos)
      flat += '\n'
    } else if (node.isTextblock && flat) {
      positions.push(null)
      flat += '\n'
    }
  })
  const index = flat.indexOf(text)
  if (index === -1) throw new Error(`"${text}" not found in "${flat}"`)
  editor.commands.setTextSelection({ from: positions[index], to: positions[index + text.length - 1] + 1 })
}

function click(title) {
  const button = TOOLBAR_BUTTONS.find((b) => b.title === title)
  button.command(editor.chain()).run()
}

describe('block formatting a highlighted part of a paragraph', () => {
  it('turns only the highlighted sentence into a heading, leaving the rest of the paragraph alone', () => {
    editorWith('<p>First sentence. Second sentence. Third sentence.</p>')
    highlight('Second sentence.')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<p>First sentence.</p><h1>Second sentence.</h1><p>Third sentence.</p>')
  })

  it('ignores spaces caught at either end of the highlight', () => {
    editorWith('<p>First sentence. Second sentence. Third sentence.</p>')
    highlight(' Second sentence. ')
    click('Heading 2')
    expect(editor.getHTML()).toBe('<p>First sentence.</p><h2>Second sentence.</h2><p>Third sentence.</p>')
  })

  it('handles text whose lines are line breaks inside one paragraph (pasted or imported text)', () => {
    editorWith('<p>line one<br>line two<br>line three</p>')
    highlight('line two')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<p>line one</p><h1>line two</h1><p>line three</p>')
  })

  it('leaves no empty paragraph when the highlight starts the paragraph', () => {
    editorWith('<p>Start here. Then more.</p>')
    highlight('Start here.')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<h1>Start here.</h1><p>Then more.</p>')
  })

  it('leaves no empty paragraph when the highlight ends the paragraph', () => {
    editorWith('<p>Some text. The end.</p>')
    highlight('The end.')
    click('Heading 3')
    // The editor always keeps an empty paragraph after a heading at the
    // very end, so there's somewhere to keep typing.
    expect(editor.getHTML()).toBe('<p>Some text.</p><h3>The end.</h3><p></p>')
  })

  it('never touches other paragraphs', () => {
    editorWith('<p>Before.</p><p>Keep this. Make this a heading. Keep this too.</p><p>After.</p>')
    highlight('Make this a heading.')
    click('Heading 1')
    expect(editor.getHTML()).toBe(
      '<p>Before.</p><p>Keep this.</p><h1>Make this a heading.</h1><p>Keep this too.</p><p>After.</p>',
    )
  })

  it('keeps bold and other formatting in the parts that are split off', () => {
    editorWith('<p>Hello <strong>bold</strong> world. Next part.</p>')
    highlight('Next part.')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<p>Hello <strong>bold</strong> world.</p><h1>Next part.</h1><p></p>')
  })

  it('formats exactly the highlighted text across two paragraphs', () => {
    editorWith('<p>A one. A two.</p><p>B one. B two.</p>')
    highlight('A two.\nB one.')
    click('Heading 2')
    expect(editor.getHTML()).toBe('<p>A one.</p><h2>A two.</h2><h2>B one.</h2><p>B two.</p>')
  })

  it('does the same for lists, quotes, callouts and code blocks', () => {
    const cases = {
      'Bullet list': '<p>One.</p><ul><li><p>Two.</p></li></ul><p>Three.</p>',
      'Numbered list': '<p>One.</p><ol><li><p>Two.</p></li></ol><p>Three.</p>',
      Blockquote: '<p>One.</p><blockquote><p>Two.</p></blockquote><p>Three.</p>',
      'Code block': '<p>One.</p><pre><code>Two.</code></pre><p>Three.</p>',
    }
    for (const [title, expected] of Object.entries(cases)) {
      editorWith('<p>One. Two. Three.</p>')
      highlight('Two.')
      click(title)
      expect(editor.getHTML(), title).toBe(expected)
      editor.destroy()
    }
    editorWith('<p>One. Two. Three.</p>')
    highlight('Two.')
    click('Callout')
    expect(editor.getHTML()).toMatch(/^<p>One\.<\/p><div[^>]*data-type="callout"[^>]*><p>Two\.<\/p><\/div><p>Three\.<\/p>$/)
  })

  it('turning a heading off only un-formats the highlighted part', () => {
    editorWith('<h1>Big one. Big two.</h1>')
    highlight('Big two.')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<h1>Big one.</h1><p>Big two.</p><p></p>')
  })

  it('is a single undo step', () => {
    editorWith('<p>First sentence. Second sentence. Third sentence.</p>')
    highlight('Second sentence.')
    click('Heading 1')
    editor.commands.undo()
    expect(editor.getHTML()).toBe('<p>First sentence. Second sentence. Third sentence.</p>')
  })
})

describe('unchanged behaviour', () => {
  it('with nothing highlighted, a button still formats the whole line the cursor is in', () => {
    editorWith('<p>Whole paragraph here.</p><p>Other.</p>')
    editor.commands.setTextSelection(5)
    click('Heading 1')
    expect(editor.getHTML()).toBe('<h1>Whole paragraph here.</h1><p>Other.</p>')
  })

  it('highlighting a whole paragraph formats just that paragraph', () => {
    editorWith('<p>All of this.</p><p>Not this.</p>')
    highlight('All of this.')
    click('Heading 1')
    expect(editor.getHTML()).toBe('<h1>All of this.</h1><p>Not this.</p>')
  })

  it('inline formatting like bold still applies to just the highlighted words', () => {
    editorWith('<p>Make one word bold here.</p>')
    highlight('word')
    click('Bold')
    expect(editor.getHTML()).toBe('<p>Make one <strong>word</strong> bold here.</p>')
  })
})
