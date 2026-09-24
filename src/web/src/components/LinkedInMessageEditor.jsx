import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { Callout } from '../lib/CalloutExtension.js'
import { YoutubeEmbed } from '../lib/YoutubeEmbedExtension.js'
import { serializeToLinkedInText, plainTextToEditorHTML, linkedinTextLength } from '../lib/linkedinTextFormat.js'
import { MAX_MESSAGE_LENGTH } from '../lib/socialPosting.js'
import { EditorToolbar } from './RichTextEditor.jsx'
import { ImagePicker } from './ImagePicker.jsx'
import './LinkedInMessageEditor.css'

// The exact same editor PostForm.jsx uses for blog posts -- same
// extensions, same full toolbar, same ImagePicker -- not a cut-down
// version. LinkedIn's post text has no real equivalent for most of
// what this editor can produce (headings, lists, quotes, code blocks,
// embeds), but every one of those still has *some* button here; what
// changes is how lib/linkedinTextFormat.js flattens the result into
// plain text, not which buttons exist.
export function LinkedInMessageEditor({ value, onChange, organizationId, userId, ariaLabel }) {
  const [length, setLength] = useState(() => linkedinTextLength(value))
  const [pickerOpen, setPickerOpen] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image, Underline, Callout, YoutubeEmbed],
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

  function handleImageSelected(url) {
    editor.chain().focus().setImage({ src: url }).run()
    setPickerOpen(false)
  }

  return (
    <div className="linkedin-message-editor">
      <div className="editor-shell">
        <EditorToolbar editor={editor} onInsertImage={() => setPickerOpen(true)} />
        <EditorContent editor={editor} className="editor-content" />
      </div>
      <div className={`linkedin-message-count${length > MAX_MESSAGE_LENGTH ? ' over' : ''}`}>
        {length}/{MAX_MESSAGE_LENGTH}
      </div>
      {pickerOpen && (
        <ImagePicker
          organizationId={organizationId}
          userId={userId}
          onSelect={handleImageSelected}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
