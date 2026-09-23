import { useEditorState } from '@tiptap/react'
import { TOOLBAR_BUTTONS, extractYoutubeId } from '../lib/richTextToolbar.js'
import './RichTextEditor.css'

// The formatting toolbar + its active-button-state wiring, shared by
// PostForm.jsx (the full blog editor: every button, plus Link/Image/
// Video) and LinkedInMessageEditor.jsx (buttons=BASIC_TOOLBAR_BUTTONS,
// showLink/showVideo off -- see lib/richTextToolbar.js for why).
export function EditorToolbar({ editor, buttons = TOOLBAR_BUTTONS, onInsertImage, showLink = true, showVideo = true }) {
  const activeState = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor ? Object.fromEntries(buttons.map((b) => [b.title, editor.isActive(b.active, b.activeAttrs)])) : {},
  })

  if (!editor) return null

  function setLink() {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function insertVideo() {
    const input = window.prompt('YouTube video URL')
    if (!input) return
    const videoId = extractYoutubeId(input)
    if (!videoId) {
      window.alert('Could not find a YouTube video ID in that URL.')
      return
    }
    editor.chain().focus().insertContent({ type: 'youtubeEmbed', attrs: { videoId } }).run()
  }

  return (
    <div className="editor-toolbar">
      {buttons.map((b) => (
        <button
          key={b.title}
          type="button"
          className={activeState[b.title] ? 'active' : ''}
          title={b.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => b.command(editor.chain().focus()).run()}
        >
          <img src={b.icon} alt={b.title} />
        </button>
      ))}
      {showLink && (
        <button type="button" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={setLink}>
          <img src="/icons/copy-link.svg" alt="Link" />
        </button>
      )}
      {onInsertImage && (
        <button type="button" title="Image" onMouseDown={(e) => e.preventDefault()} onClick={onInsertImage}>
          <img src="/icons/image.svg" alt="Image" />
        </button>
      )}
      {showVideo && (
        <button type="button" title="Video" onMouseDown={(e) => e.preventDefault()} onClick={insertVideo}>
          <img src="/icons/video.svg" alt="Video" />
        </button>
      )}
    </div>
  )
}
