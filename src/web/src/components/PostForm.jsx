import { useEffect, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { supabase } from '../lib/supabaseClient.js'
import { ImagePicker } from './ImagePicker.jsx'
import './PostForm.css'

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

function EditorToolbar({ editor, onInsertImage }) {
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
      <button type="button" title="Image" onMouseDown={(e) => e.preventDefault()} onClick={onInsertImage}>
        Image
      </button>
    </div>
  )
}

export function PostForm({ session, postId, onSaved }) {
  const [membership, setMembership] = useState(undefined)
  const [post, setPost] = useState(undefined)
  const [loadedIntoEditor, setLoadedIntoEditor] = useState(false)
  const [title, setTitle] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState(null)
  const [pickerTarget, setPickerTarget] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image],
    content: '',
  })

  useEffect(() => {
    if (postId) return
    supabase
      .from('memberships')
      .select('role, organizations(id, name)')
      .eq('user_id', session.user.id)
      .in('role', ['owner', 'editor'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMembership(data ?? null))
  }, [session.user.id, postId])

  useEffect(() => {
    if (!postId) return
    supabase
      .from('posts')
      .select('id, title, content, status, author_id, published_at, thumbnail_url, organization_id, organizations(name)')
      .eq('id', postId)
      .single()
      .then(({ data }) => setPost(data ?? null))
  }, [postId])

  useEffect(() => {
    if (!postId || !post || !editor || loadedIntoEditor) return
    setTitle(post.title)
    setThumbnailUrl(post.thumbnail_url)
    editor.commands.setContent(post.content)
    setLoadedIntoEditor(true)
  }, [post, editor, postId, loadedIntoEditor])

  const organizationId = postId ? post?.organization_id : membership?.organizations?.id
  const organizationName = postId ? post?.organizations?.name : membership?.organizations?.name

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

    const payload = {
      organization_id: organizationId,
      author_id: postId ? post.author_id : session.user.id,
      title: title.trim(),
      content: editor.getHTML(),
      status,
      thumbnail_url: thumbnailUrl,
      published_at: status === 'published' ? (post?.published_at ?? new Date().toISOString()) : null,
    }
    if (postId) payload.id = postId

    const { data, error: saveError } = await supabase
      .from('posts')
      .upsert(payload)
      .select('id, slug')
      .single()

    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }

    setNotice(status === 'published' ? 'Post published.' : 'Draft saved.')
    onSaved?.(data)
  }

  function handleImageSelected(url) {
    if (pickerTarget === 'thumbnail') {
      setThumbnailUrl(url)
    } else if (pickerTarget === 'inline') {
      editor.chain().focus().setImage({ src: url }).run()
    }
    setPickerTarget(null)
  }

  if (postId) {
    if (post === undefined) return <p className="post-form-status">Loading…</p>
    if (post === null) {
      return <p className="post-form-status">That post doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
    }
  } else if (membership === undefined) {
    return <p className="post-form-status">Loading…</p>
  } else if (membership === null) {
    return (
      <p className="post-form-status">
        You need to be an author on a blog to create posts. Register as an author, or use an
        invite code to join an existing one.
      </p>
    )
  }

  return (
    <div id="create-post">
      <h2>
        {postId ? 'Edit post' : 'New post'} — {organizationName}
      </h2>
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
        <span>Thumbnail (optional)</span>
        {thumbnailUrl && <img src={thumbnailUrl} alt="" className="thumbnail-preview" />}
        <div className="thumbnail-actions">
          <button type="button" className="link" onClick={() => setPickerTarget('thumbnail')}>
            {thumbnailUrl ? 'Change image' : 'Choose image'}
          </button>
          {thumbnailUrl && (
            <button type="button" className="link" onClick={() => setThumbnailUrl(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span>Body</span>
        <div className="editor-shell">
          <EditorToolbar editor={editor} onInsertImage={() => setPickerTarget('inline')} />
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
      {pickerTarget && (
        <ImagePicker
          organizationId={organizationId}
          userId={session.user.id}
          onSelect={handleImageSelected}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}
