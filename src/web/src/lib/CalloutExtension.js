import { Node, mergeAttributes } from '@tiptap/core'

// A "bug card"-style callout block: a colored box with an accent left
// border, wrapping one or more paragraphs/lists/etc. Rendered as a plain
// `<div data-type="callout" class="callout">` -- no exotic tag, so it
// round-trips cleanly through DOMPurify's default allow-list (div,
// class, and data-* attributes are all allowed by default) when the
// published post is sanitized in TenantBlog.jsx.
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'callout' }), 0]
  },

  addCommands() {
    return {
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    }
  },
})
