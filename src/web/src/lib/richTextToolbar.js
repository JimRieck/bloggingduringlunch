// Accepts a full YouTube URL (watch/embed/youtu.be, with or without
// extra query params) or a bare 11-character video id typed directly.
export function extractYoutubeId(input) {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  if (urlMatch) return urlMatch[1]
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  return null
}

export const TOOLBAR_BUTTONS = [
  { title: 'Bold', icon: '/icons/bold.svg', command: (chain) => chain.toggleBold(), active: 'bold' },
  { title: 'Italic', icon: '/icons/italic.svg', command: (chain) => chain.toggleItalic(), active: 'italic' },
  {
    title: 'Underline',
    icon: '/icons/underline.svg',
    command: (chain) => chain.toggleUnderline(),
    active: 'underline',
  },
  { title: 'Inline code', icon: '/icons/inline-code.svg', command: (chain) => chain.toggleCode(), active: 'code' },
  {
    title: 'Heading 1',
    icon: '/icons/heading-1.svg',
    command: (chain) => chain.toggleHeading({ level: 1 }),
    active: 'heading',
    activeAttrs: { level: 1 },
  },
  {
    title: 'Heading 2',
    icon: '/icons/heading-2.svg',
    command: (chain) => chain.toggleHeading({ level: 2 }),
    active: 'heading',
    activeAttrs: { level: 2 },
  },
  {
    title: 'Heading 3',
    icon: '/icons/heading-3.svg',
    command: (chain) => chain.toggleHeading({ level: 3 }),
    active: 'heading',
    activeAttrs: { level: 3 },
  },
  {
    title: 'Bullet list',
    icon: '/icons/bullet-list.svg',
    command: (chain) => chain.toggleBulletList(),
    active: 'bulletList',
  },
  {
    title: 'Numbered list',
    icon: '/icons/numbered-list.svg',
    command: (chain) => chain.toggleOrderedList(),
    active: 'orderedList',
  },
  {
    title: 'Blockquote',
    icon: '/icons/blockquote.svg',
    command: (chain) => chain.toggleBlockquote(),
    active: 'blockquote',
  },
  {
    title: 'Callout',
    icon: '/icons/callout.svg',
    command: (chain) => chain.toggleCallout(),
    active: 'callout',
  },
  {
    title: 'Code block',
    icon: '/icons/code-block.svg',
    command: (chain) => chain.toggleCodeBlock(),
    active: 'codeBlock',
  },
]
