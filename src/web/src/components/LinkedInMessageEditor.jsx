import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BASIC_TOOLBAR_BUTTONS } from '../lib/richTextToolbar.js'
import { serializeToLinkedInText, plainTextToEditorHTML, linkedinTextLength } from '../lib/linkedinTextFormat.js'
import { MAX_MESSAGE_LENGTH } from '../lib/socialPosting.js'
import { EditorToolbar } from './RichTextEditor.jsx'
import './LinkedInMessageEditor.css'

// The same rich-text editor as the blog post editor (RichTextEditor.jsx,
// PostForm.jsx), not a bare textarea -- narrowed to what a LinkedIn post
// can actually represent. LinkedIn's post text has no headings, lists,
// quotes or embeds, so those extensions are left out entirely rather
// than just hidden from the toolbar (typing "## " or "1. " won't
// silently trigger StarterKit's markdown-shortcut behavior for a
// structure this editor can't serialize). `value` seeds the initial
// content only -- like PostForm's own editor, this is uncontrolled
// afterward; the parent gets updates via onChange, not by feeding value
// back in.
export function LinkedInMessageEditor({ value, onChange, ariaLabel }) {
  const [length, setLength] = useState(() => linkedinTextLength(value))

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: false,
      }),
    ],
    content: plainTextToEditorHTML(value),
    editorProps: {
      attributes: ariaLabel ? { 'aria-label': ariaLabel } : {},
    },
    onUpdate: ({ editor }) => {
      const text = serializeToLinkedInText(editor)
      setLength(linkedinTextLength(text))
      onChange(text)
    },
  })

  return (
    <div className="linkedin-message-editor">
      <div className="editor-shell">
        <EditorToolbar editor={editor} buttons={BASIC_TOOLBAR_BUTTONS} showLink={false} showVideo={false} />
        <EditorContent editor={editor} className="editor-content" />
      </div>
      <div className={`linkedin-message-count${length > MAX_MESSAGE_LENGTH ? ' over' : ''}`}>
        {length}/{MAX_MESSAGE_LENGTH}
      </div>
    </div>
  )
}
