import { useEffect, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { supabase } from '../lib/supabaseClient.js'
import './CreatePostForm.css'

const TOOLBAR_BUTTONS = [
  { label: 'Bold', title: 'Bold', command: (chain) => chain.toggleBold(), active: 'bold' },
  { label: 'Italic', title: 'Italic', command: (chain) => chain.toggleItalic(), active: 'italic' },
  { label: 'Code', title: 'Inline code', command: (chain) => chain.toggleCode(), active: 'code' },
  {
    label: 'H2',
    title: 'Heading',
    command: (chain) => chain.toggleHeading({ level: 2 }),
    active: 'heading',
    activeAttrs: { level: 2 },
  },
  {
    label: 'H3',
    title: 'Subheading',
    command: (chain) => chain.toggleHeading({ level: 3 }),
    active: 'heading',
    activeAttrs: { level: 3 },
  },
  { label: 'List', title: 'Bullet list', command: (chain) => chain.toggleBulletList(), active: 'bulletList' },
  { label: '1. List', title: 'Numbered list', command: (chain) => chain.toggleOrderedList(), active: 'orderedList' },
  { label: 'Quote', title: 'Blockquote', command: (chain) => chain.toggleBlockquote(), active: 'blockquote' },
  { label: '{ }', title: 'Code block', command: (chain) => chain.toggleCodeBlock(), active: 'codeBlock' },
]

function EditorToolbar({ editor }) {
  const activeState = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? Object.fromEntries(
            TOOLBAR_BUTTONS.map((b) => [b.label, editor.isActive(b.active, b.activeAttrs)]),
          )
        : {},
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

  return (
    <div className="editor-toolbar">
      {TOOLBAR_BUTTONS.map((b) => (
        <button
          key={b.label}
          type="button"
          className={activeState[b.label] ? 'active' : ''}
          title={b.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => b.command(editor.chain().focus()).run()}
        >
          {b.label}
        </button>
      ))}
      <button type="button" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={setLink}>
        Link
      </button>
    </div>
  )
}

export function CreatePostForm({ session, onCreated }) {
  const [membership, setMembership] = useState(undefined)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    content: '',
  })

  useEffect(() => {
    supabase
      .from('memberships')
      .select('role, organizations(id, name, slug)')
      .eq('user_id', session.user.id)
      .in('role', ['owner', 'editor'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMembership(data ?? null))
  }, [session.user.id])

  async function handleSave(status) {
    if (!title.trim()) {
      setError('Give your post a title.')
      return
    }
    if (!editor || editor.isEmpty) {
      setError('Write something in the post body.')
      return
    }
    setError('')
    setSaving(true)

    const { data, error: insertError } = await supabase
      .from('posts')
      .insert({
        organization_id: membership.organizations.id,
        author_id: session.user.id,
        title: title.trim(),
        content: editor.getHTML(),
        status,
        published_at: status === 'published' ? new Date().toISOString() : null,
      })
      .select('slug')
      .single()

    setSaving(false)
    if (insertError) {
      setError(insertError.message)
      return
    }

    setTitle('')
    editor.commands.clearContent()
    setNotice(status === 'published' ? 'Post published.' : 'Draft saved.')
    onCreated?.(data)
  }

  if (membership === undefined) {
    return <p className="post-form-status">Loading…</p>
  }

  if (membership === null) {
    return (
      <p className="post-form-status">
        You need to be an author on a blog to create posts. Register as an author, or use an
        invite code to join an existing one.
      </p>
    )
  }

  return (
    <div id="create-post">
      <h2>New post — {membership.organizations.name}</h2>
      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What are you writing about?"
        />
      </label>
      <div className="field">
        <span>Body</span>
        <div className="editor-shell">
          <EditorToolbar editor={editor} />
          <EditorContent editor={editor} className="editor-content" />
        </div>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}
      <div className="post-form-actions">
        <button type="button" className="link" disabled={saving} onClick={() => handleSave('draft')}>
          Save draft
        </button>
        <button type="button" className="primary" disabled={saving} onClick={() => handleSave('published')}>
          Publish
        </button>
      </div>
    </div>
  )
}
