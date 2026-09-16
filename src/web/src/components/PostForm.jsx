import { useEffect, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { supabase } from '../lib/supabaseClient.js'
import { Callout } from '../lib/CalloutExtension.js'
import { YoutubeEmbed } from '../lib/YoutubeEmbedExtension.js'
import { ImagePicker } from './ImagePicker.jsx'
import './PostForm.css'

// Accepts a full YouTube URL (watch/embed/youtu.be, with or without
// extra query params) or a bare 11-character video id typed directly.
function extractYoutubeId(input) {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/)
  if (urlMatch) return urlMatch[1]
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  return null
}

const TOOLBAR_BUTTONS = [
  { title: 'Bold', icon: '/icons/bold.svg', command: (chain) => chain.toggleBold(), active: 'bold' },
  { title: 'Italic', icon: '/icons/italic.svg', command: (chain) => chain.toggleItalic(), active: 'italic' },
  { title: 'Inline code', icon: '/icons/inline-code.svg', command: (chain) => chain.toggleCode(), active: 'code' },
  {
    title: 'Heading',
    icon: '/icons/heading-2.svg',
    command: (chain) => chain.toggleHeading({ level: 2 }),
    active: 'heading',
    activeAttrs: { level: 2 },
  },
  {
    title: 'Subheading',
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

function EditorToolbar({ editor, onInsertImage }) {
  const activeState = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? Object.fromEntries(
            TOOLBAR_BUTTONS.map((b) => [b.title, editor.isActive(b.active, b.activeAttrs)]),
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
      {TOOLBAR_BUTTONS.map((b) => (
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
      <button type="button" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={setLink}>
        <img src="/icons/copy-link.svg" alt="Link" />
      </button>
      <button type="button" title="Image" onMouseDown={(e) => e.preventDefault()} onClick={onInsertImage}>
        <img src="/icons/image.svg" alt="Image" />
      </button>
      <button type="button" title="Video" onMouseDown={(e) => e.preventDefault()} onClick={insertVideo}>
        <img src="/icons/video.svg" alt="Video" />
      </button>
    </div>
  )
}

export function PostForm({ session, postId, onSaved }) {
  const [membership, setMembership] = useState(undefined)
  const [post, setPost] = useState(undefined)
  const [loadedPost, setLoadedPost] = useState(null)
  const [title, setTitle] = useState('')
  const [thumbnailUrl, setThumbnailUrl] = useState(null)
  const [pickerTarget, setPickerTarget] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState(new Set())
  const [newCategoryName, setNewCategoryName] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [authorTags, setAuthorTags] = useState([])
  const [tagChips, setTagChips] = useState([])
  const [tagInput, setTagInput] = useState('')

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image, Callout, YoutubeEmbed],
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

  // React's own recommended pattern for "reset/derive some state when
  // an async value changes" (see "Adjusting state when a prop changes"
  // in the React docs) -- adjusting state during render, rather than in
  // a useEffect, re-renders synchronously with no extra commit, and
  // doesn't trip the "don't setState synchronously inside an effect"
  // warning that doing this in an effect would.
  if (postId && post && post !== loadedPost) {
    setLoadedPost(post)
    setTitle(post.title)
    setThumbnailUrl(post.thumbnail_url)
  }

  // The one piece that genuinely has to be an effect: editor.commands.
  // setContent is an imperative call into Tiptap's own external editor
  // instance, which can't happen during React's render phase. Runs
  // exactly once, whenever both the editor and the post state adjusted
  // above are ready -- neither changes again afterward, so this doesn't
  // re-fire on every render.
  useEffect(() => {
    if (!editor || !loadedPost) return
    editor.commands.setContent(loadedPost.content)
  }, [editor, loadedPost])

  const organizationId = postId ? post?.organization_id : membership?.organizations?.id
  const organizationName = postId ? post?.organizations?.name : membership?.organizations?.name
  const postAuthorId = postId ? post?.author_id : session.user.id
  const isAuthor = postAuthorId === session.user.id

  useEffect(() => {
    if (!organizationId) return
    supabase
      .from('categories')
      .select('id, name')
      .eq('organization_id', organizationId)
      .order('name')
      .then(({ data }) => setCategories(data ?? []))
  }, [organizationId])

  useEffect(() => {
    supabase
      .from('tags')
      .select('id, name')
      .eq('author_id', session.user.id)
      .order('name')
      .then(({ data }) => setAuthorTags(data ?? []))
  }, [session.user.id])

  useEffect(() => {
    if (!postId || !post) return
    supabase
      .from('post_categories')
      .select('category_id')
      .eq('post_id', postId)
      .then(({ data }) => setSelectedCategoryIds(new Set((data ?? []).map((r) => r.category_id))))
    supabase
      .from('post_tags')
      .select('tags(name)')
      .eq('post_id', postId)
      .then(({ data }) => setTagChips((data ?? []).map((r) => r.tags?.name).filter(Boolean)))
  }, [postId, post])

  function toggleCategory(id) {
    setSelectedCategoryIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleAddCategory() {
    const name = newCategoryName.trim()
    if (!name || !organizationId) return
    setAddingCategory(true)
    const { data, error: addError } = await supabase
      .from('categories')
      .insert({ organization_id: organizationId, name })
      .select('id, name')
      .single()
    setAddingCategory(false)
    if (addError) {
      setError(addError.message)
      return
    }
    setCategories((current) => [...current, data].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedCategoryIds((current) => new Set(current).add(data.id))
    setNewCategoryName('')
  }

  function commitTagInput() {
    const name = tagInput.trim()
    if (name && !tagChips.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagChips((current) => [...current, name])
    }
    setTagInput('')
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commitTagInput()
    }
  }

  function addSuggestedTag(name) {
    if (!tagChips.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagChips((current) => [...current, name])
    }
    setTagInput('')
  }

  function removeTagChip(name) {
    setTagChips((current) => current.filter((t) => t !== name))
  }

  const tagSuggestions = tagInput.trim()
    ? authorTags
        .filter((t) => t.name.toLowerCase().includes(tagInput.trim().toLowerCase()))
        .filter((t) => !tagChips.some((chip) => chip.toLowerCase() === t.name.toLowerCase()))
        .slice(0, 6)
    : []

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

    if (saveError) {
      setSaving(false)
      setError(saveError.message)
      return
    }

    const savedPostId = data.id

    // Tag rows aren't created until save (matching WordPress's own
    // behavior) -- resolve each chip against the author's already-loaded
    // tags, creating any that don't exist yet.
    const tagIds = []
    for (const name of tagChips) {
      const existing = authorTags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        tagIds.push(existing.id)
        continue
      }
      const { data: newTag, error: tagError } = await supabase
        .from('tags')
        .insert({ author_id: session.user.id, name })
        .select('id, name')
        .single()
      if (tagError) {
        setSaving(false)
        setError(tagError.message)
        return
      }
      setAuthorTags((current) => [...current, newTag])
      tagIds.push(newTag.id)
    }

    // Simplest correct sync: replace the full set rather than diffing --
    // category/tag counts on one post are always small.
    await supabase.from('post_categories').delete().eq('post_id', savedPostId)
    if (selectedCategoryIds.size > 0) {
      await supabase
        .from('post_categories')
        .insert([...selectedCategoryIds].map((category_id) => ({ post_id: savedPostId, category_id })))
    }

    if (isAuthor) {
      await supabase.from('post_tags').delete().eq('post_id', savedPostId)
      if (tagIds.length > 0) {
        await supabase.from('post_tags').insert(tagIds.map((tag_id) => ({ post_id: savedPostId, tag_id })))
      }
    }

    setSaving(false)
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
        <span>Categories</span>
        <div className="taxonomy-box">
          {categories.length === 0 ? (
            <p className="taxonomy-empty">No categories yet.</p>
          ) : (
            <ul className="category-checklist">
              {categories.map((c) => (
                <li key={c.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedCategoryIds.has(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                    {c.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="taxonomy-add-new">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddCategory()
                }
              }}
              placeholder="New category name"
              disabled={addingCategory}
            />
            <button type="button" className="link" onClick={handleAddCategory} disabled={addingCategory}>
              + Add New Category
            </button>
          </div>
        </div>
      </div>
      {isAuthor && (
        <div className="field">
          <span>Tags</span>
          <div className="taxonomy-box">
            <div className="tag-chip-input">
              {tagChips.map((t) => (
                <span className="tag-chip" key={t}>
                  {t}
                  <button type="button" onClick={() => removeTagChip(t)} aria-label={`Remove ${t}`}>
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={commitTagInput}
                placeholder="Add a tag, press Enter"
              />
            </div>
            {tagSuggestions.length > 0 && (
              <ul className="tag-suggestions">
                {tagSuggestions.map((s) => (
                  <li key={s.id}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addSuggestedTag(s.name)}>
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
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
