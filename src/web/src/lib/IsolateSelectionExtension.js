import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

// Block formats (headings, lists, quotes, callouts, code blocks) apply
// to a whole paragraph, not to a span of text -- so highlighting one
// sentence and clicking H1 used to turn the entire paragraph (or, for
// text pasted with line breaks, many lines) into a heading. This splits
// the paragraph around the highlighted text first, so the block format
// that follows lands on exactly what was highlighted. Spaces and line
// breaks at the cut points are dropped rather than left dangling. With
// nothing highlighted it does nothing, so a button still formats the
// line the cursor is on.

// Line breaks count as blank, other inline nodes (images) don't; each
// inline node is one position wide, so string offsets match positions.
const leafText = (node) => (node.type.name === 'hardBreak' ? '\n' : '￼')
const leadingBlank = (text) => text.length - text.trimStart().length
const trailingBlank = (text) => text.length - text.trimEnd().length

export function isolateSelection(tr) {
  const { from, to, empty } = tr.selection
  if (empty) return false

  const selected = tr.doc.textBetween(from, to, '\n', leafText)
  if (!selected.trim()) return false
  let start = from + leadingBlank(selected)
  let end = to - trailingBlank(selected)

  // The end first, so `start` isn't moved by changes after it.
  const $end = tr.doc.resolve(end)
  if ($end.parent.isTextblock) {
    const after = $end.parent.textBetween($end.parentOffset, $end.parent.content.size, null, leafText)
    if (after.trim()) {
      const blank = leadingBlank(after)
      if (blank) tr.delete(end, end + blank)
      tr.split(end)
    }
  }

  const $start = tr.doc.resolve(start)
  if ($start.parent.isTextblock) {
    const before = $start.parent.textBetween(0, $start.parentOffset, null, leafText)
    if (before.trim()) {
      const blank = trailingBlank(before)
      if (blank) {
        tr.delete(start - blank, start)
        start -= blank
        end -= blank
      }
      tr.split(start)
      // A split adds a block boundary (2 positions) before the selection.
      start += 2
      end += 2
    }
  }

  tr.setSelection(TextSelection.create(tr.doc, start, end))
  return true
}

export const IsolateSelection = Extension.create({
  name: 'isolateSelection',

  addCommands() {
    return {
      isolateSelection:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) isolateSelection(tr)
          // Always succeeds, so it can lead a chain whether or not
          // anything needed splitting.
          return true
        },
    }
  },
})
