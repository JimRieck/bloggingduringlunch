import { useEffect, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { supabase } from '../lib/supabaseClient.js'
import { Callout } from '../lib/CalloutExtension.js'
import { YoutubeEmbed } from '../lib/YoutubeEmbedExtension.js'
import { resolveCategoryIds } from '../lib/taxonomy.js'
import { useFeatureFlags } from '../lib/featureFlags.js'
import { ImagePicker } from './ImagePicker.jsx'
import { TitleSuggestModal } from './TitleSuggestModal.jsx'
import { GeneratePostModal } from './GeneratePostModal.jsx'
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
  const [suggesting, setSuggesting] = useState(false)
  const [titleSuggestOpen, setTitleSuggestOpen] = useState(false)
  const [generatePostOpen, setGeneratePostOpen] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const featureFlags = useFeatureFlags()

  const editor = useEditor({
    extensions: [StarterKit, Link.configure({ openOnClick: false }), Image, Underline, Callout, YoutubeEmbed],
    content: '',
  })

  // Reactive, unlike reading editor.isEmpty directly in the render body:
  // useEditor alone doesn't re-render this component on every keystroke
  // (EditorToolbar's own active-button states need the same
  // useEditorState subscription for the same reason) -- without this,
  // Suggest titles/Generate Image would stay stuck showing whatever
  // isEmpty was on PostForm's last render for some unrelated reason,
  // not the body's actual current state.
  const isBodyEmpty = useEditorState({
    editor,
    selector: ({ editor }) => !editor || editor.isEmpty,
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

  // Categories are org-wide, so this removes it from every post that
  // uses it across the org, not just the one being edited -- worth a
  // real confirmation, matching the same window.confirm pattern
  // MyPosts.jsx already uses before deleting a post.
  async function handleDeleteCategory(category) {
    if (
      !window.confirm(
        `Delete the category "${category.name}"? This removes it from every post that uses it across ${organizationName}, not just this one.`,
      )
    ) {
      return
    }
    const { error: deleteError } = await supabase.from('categories').delete().eq('id', category.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setCategories((current) => current.filter((c) => c.id !== category.id))
    setSelectedCategoryIds((current) => {
      const next = new Set(current)
      next.delete(category.id)
      return next
    })
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

  // AI-suggested categories/tags are added to the existing selection,
  // never replacing it, and land in the exact same editable UI a manual
  // pick does -- nothing is persisted until Save. Categories are created
  // immediately for an unmatched suggestion (same as "+ Add New
  // Category" already does); tags are left as plain chip strings, same
  // as typing one manually, since tag rows aren't created until Save.
  async function handleAutoSuggest() {
    if (!editor || !organizationId) return
    const content = editor.getText().trim()
    if (!title.trim() && !content) {
      setError('Write something first, then auto-suggest tags and categories.')
      return
    }
    setError('')
    setSuggesting(true)

    const { data, error: suggestError } = await supabase.functions.invoke('suggest-tags-and-categories', {
      body: {
        title: title.trim(),
        content,
        existingCategories: categories.map((c) => c.name),
        existingTags: authorTags.map((t) => t.name),
      },
    })

    if (suggestError || data?.error) {
      setSuggesting(false)
      // supabase-js doesn't parse a non-2xx function response body into
      // `data` -- the specific error code this function returns (e.g.
      // "not_configured") only shows up in `error.context`, the raw
      // Response, so it has to be read out separately here.
      let reason = data?.error
      if (!reason && suggestError?.context) {
        try {
          reason = (await suggestError.context.json())?.error
        } catch {
          // context wasn't JSON, or already consumed -- fall through to
          // the generic message below
        }
      }
      setError(
        reason === 'not_configured'
          ? 'Auto-suggest isn’t configured yet.'
          : 'Couldn’t generate suggestions. Try again.',
      )
      return
    }

    const categoriesCopy = [...categories]
    const newCategoryIds = await resolveCategoryIds(data.categories ?? [], organizationId, categoriesCopy)
    setCategories(categoriesCopy.sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedCategoryIds((current) => new Set([...current, ...newCategoryIds]))

    if (isAuthor) {
      const suggestedTagNames = (data.tags ?? []).filter(
        (name) => !tagChips.some((chip) => chip.toLowerCase() === name.toLowerCase()),
      )
      setTagChips((current) => [...current, ...suggestedTagNames])
    }

    setSuggesting(false)
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

  // No popup needed here, unlike title suggestions (a list to choose
  // from) -- there's only one sensible input (whatever's already
  // written), so this applies its result directly, same shape as
  // handleAutoSuggest.
  async function handleGenerateImage() {
    if (!editor || editor.isEmpty || !organizationId) return
    setError('')
    setGeneratingImage(true)

    const { data, error: generateError } = await supabase.functions.invoke('generate-post-image', {
      body: { organizationId, title: title.trim(), content: editor.getText() },
    })
    setGeneratingImage(false)

    if (generateError || data?.error) {
      let reason = data?.error
      if (!reason && generateError?.context) {
        try {
          reason = (await generateError.context.json())?.error
        } catch {
          // context wasn't JSON, or already consumed -- fall through
        }
      }
      setError(
        reason === 'not_configured'
          ? 'Generating images isn’t configured yet.'
          : reason === 'insufficient_credits'
            ? 'The OpenAI account behind image generation has no credits left. Add billing at platform.openai.com, then try again.'
            : 'Couldn’t generate an image. Try again.',
      )
      return
    }
    setThumbnailUrl(data.url)
  }

  // Confirms before clobbering existing work -- the modal itself just
  // reports the generated HTML back up, since only this component knows
  // whether the body already has content worth protecting.
  function handleGeneratedContent(content) {
    if (
      !editor.isEmpty &&
      !window.confirm('Replace the current body with this generated draft? This can’t be undone.')
    ) {
      return
    }
    editor.commands.setContent(content)
    setGeneratePostOpen(false)
  }

  // Same "confirm before losing work" bar as handleGeneratedContent --
  // only prompts when there's actually something to lose, so cancelling
  // out of a blank form is instant.
  function handleCancel() {
    const hasContent = title.trim() || (editor && !editor.isEmpty)
    if (hasContent && !window.confirm('Discard this post and leave the editor?')) {
      return
    }
    window.location.href = '/'
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
      <div className="field">
        <span>Title</span>
        <div className="title-row">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What are you writing about?"
          />
          {featureFlags.ai_title_generation && (
            <button
              type="button"
              className="ai-action-button"
              onClick={() => setTitleSuggestOpen(true)}
              disabled={isBodyEmpty}
              title={isBodyEmpty ? 'Write something in the body first' : 'Suggest titles based on the body'}
            >
              ✨ Suggest titles
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <span>Thumbnail (optional)</span>
        {thumbnailUrl && <img src={thumbnailUrl} alt="" className="thumbnail-preview" />}
        <div className="thumbnail-actions">
          <button type="button" className="link" onClick={() => setPickerTarget('thumbnail')}>
            <img src="/icons/image.svg" alt="" />
            {thumbnailUrl ? 'Change image' : 'Choose image'}
          </button>
          {featureFlags.ai_image_generation && (
            <button
              type="button"
              className="ai-action-button"
              onClick={handleGenerateImage}
              disabled={generatingImage || isBodyEmpty}
              title={isBodyEmpty ? 'Write something in the body first' : 'Generate an image based on the body'}
            >
              <img src="/icons/sparkles.svg" alt="" />
              {generatingImage ? 'Generating image…' : 'Generate Image'}
            </button>
          )}
          {thumbnailUrl && (
            <button type="button" className="link" onClick={() => setThumbnailUrl(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {(featureFlags.ai_tag_generation || featureFlags.ai_category_generation) && (
        <div className="field">
          <button type="button" className="ai-action-button" onClick={handleAutoSuggest} disabled={suggesting}>
            {suggesting ? 'Suggesting…' : '✨ Auto-suggest tags & categories'}
          </button>
        </div>
      )}
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
                  <button
                    type="button"
                    className="category-delete"
                    onClick={() => handleDeleteCategory(c)}
                    aria-label={`Delete category ${c.name}`}
                    title="Delete category"
                  >
                    <img src="/icons/trash.svg" alt="" />
                  </button>
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
      {featureFlags.ai_body_generation && (
        <div className="field">
          <button type="button" className="ai-action-button" onClick={() => setGeneratePostOpen(true)}>
            ✨ Generate post from description
          </button>
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
        <button type="button" className="secondary" disabled={saving} onClick={handleCancel}>
          Cancel
        </button>
        <button type="button" className="secondary" disabled={saving} onClick={() => handleSave('draft')}>
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
      {titleSuggestOpen && (
        <TitleSuggestModal
          content={editor.getText()}
          onSelect={(t) => {
            setTitle(t)
            setTitleSuggestOpen(false)
          }}
          onClose={() => setTitleSuggestOpen(false)}
        />
      )}
      {generatePostOpen && (
        <GeneratePostModal onGenerated={handleGeneratedContent} onClose={() => setGeneratePostOpen(false)} />
      )}
    </div>
  )
}
