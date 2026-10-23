import { useEffect, useRef, useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { supabase } from '../lib/supabaseClient.js'
import { postEditorExtensions } from '../lib/postEditorExtensions.js'
import { resolveCategoryIds } from '../lib/taxonomy.js'
import { useFeatureFlags } from '../lib/featureFlags.js'
import { savePostPreview } from '../lib/postPreview.js'
import { useAutoSave } from '../lib/useAutoSave.js'
import { ImagePicker } from './ImagePicker.jsx'
import { TitleSuggestModal } from './TitleSuggestModal.jsx'
import { GeneratePostModal } from './GeneratePostModal.jsx'
import { EditorToolbar } from './RichTextEditor.jsx'
import { AutoSaveStatus } from './AutoSaveStatus.jsx'
import './PostForm.css'

// Matches the posts.description check in 20261020100000_post_description.sql.
const DESCRIPTION_MAX = 150

// What auto-save compares and stores. Categories and tags aren't part of
// it -- they're still saved by Save draft / Publish.
function editSnapshot(title, description, content, thumbnailUrl) {
  return { title, description, content, thumbnailUrl }
}

function storedFields(snapshot) {
  return {
    title: snapshot.title.trim(),
    description: snapshot.description.trim() || null,
    content: snapshot.content,
    thumbnail_url: snapshot.thumbnailUrl,
  }
}

export function PostForm({ session, postId, onSaved }) {
  const [membership, setMembership] = useState(undefined)
  const [post, setPost] = useState(undefined)
  const [loadedPost, setLoadedPost] = useState(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
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
  const [writingDescription, setWritingDescription] = useState(false)
  const [previewId] = useState(() => postId ?? crypto.randomUUID())
  // The post's id once it exists -- a new post gets one on its first
  // auto-save, and from then on every save updates that row.
  const [savedPostId, setSavedPostId] = useState(postId ?? null)
  // A published post's private pending copy (post_pending_edits): null
  // when there isn't one, undefined until checked.
  const [pendingEdit, setPendingEdit] = useState(postId ? undefined : null)
  const [showingPending, setShowingPending] = useState(false)
  // updated_at of the post row and of its pending copy as this editor
  // last saw them. Auto-save only writes when they still match, so a save
  // from another tab or editor is noticed instead of overwritten.
  const versionRef = useRef({ post: null, pending: null })
  const featureFlags = useFeatureFlags()

  const editor = useEditor({
    extensions: postEditorExtensions(),
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
      .select(
        'id, title, description, content, status, author_id, published_at, thumbnail_url, organization_id, updated_at, organizations(name)',
      )
      .eq('id', postId)
      .single()
      .then(({ data }) => setPost(data ?? null))
    supabase
      .from('post_pending_edits')
      .select('title, description, content, thumbnail_url, updated_at')
      .eq('post_id', postId)
      .maybeSingle()
      .then(({ data }) => setPendingEdit(data ?? null))
  }, [postId])

  // React's own recommended pattern for "reset/derive some state when
  // an async value changes" (see "Adjusting state when a prop changes"
  // in the React docs) -- adjusting state during render, rather than in
  // a useEffect, re-renders synchronously with no extra commit, and
  // doesn't trip the "don't setState synchronously inside an effect"
  // warning that doing this in an effect would. Unpublished changes
  // saved earlier, if any, are what the author was last working on, so
  // they're what opens.
  if (postId && post && pendingEdit !== undefined && post !== loadedPost) {
    const source = pendingEdit ?? post
    setLoadedPost(post)
    setTitle(source.title)
    setDescription(source.description ?? '')
    setThumbnailUrl(source.thumbnail_url)
    setShowingPending(Boolean(pendingEdit))
  }

  const liveStatus = post?.status ?? 'draft'
  const organizationId = postId ? post?.organization_id : membership?.organizations?.id

  const autoSave = useAutoSave({
    enabled: Boolean(editor && organizationId),
    getSnapshot: () => (editor ? editSnapshot(title, description, editor.getHTML(), thumbnailUrl) : null),
    save: autoSaveEdits,
  })

  // The one piece that genuinely has to be an effect: editor.commands.
  // setContent is an imperative call into Tiptap's own external editor
  // instance, which can't happen during React's render phase. Runs
  // exactly once, whenever both the editor and the post state adjusted
  // above are ready -- neither changes again afterward, so this doesn't
  // re-fire on every render. That's also when auto-save learns what's
  // already stored.
  useEffect(() => {
    if (!editor || !loadedPost) return
    const source = pendingEdit ?? loadedPost
    editor.commands.setContent(source.content)
    versionRef.current = { post: loadedPost.updated_at, pending: pendingEdit?.updated_at ?? null }
    autoSave.markSaved(editSnapshot(source.title, source.description ?? '', editor.getHTML(), source.thumbnail_url))
    // pendingEdit is read once, alongside loadedPost; discarding it later
    // resets the editor itself (handleDiscardPending).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, loadedPost])

  // A new post starts out empty, and that's what counts as saved.
  useEffect(() => {
    if (!editor || postId) return
    autoSave.markSaved(editSnapshot('', '', editor.getHTML(), null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, postId])

  // Auto-save's save(): a new post becomes a draft row; a draft saves to
  // its own row; a published post saves to its private pending copy.
  async function autoSaveEdits(snapshot) {
    const fields = storedFields(snapshot)

    if (!savedPostId) {
      if (!fields.title && editor.isEmpty) return 'skipped'
      const { data, error: insertError } = await supabase
        .from('posts')
        .insert({
          ...fields,
          organization_id: organizationId,
          author_id: session.user.id,
          status: 'draft',
          published_at: null,
        })
        .select('id, updated_at')
        .single()
      if (insertError) throw insertError
      versionRef.current.post = data.updated_at
      setSavedPostId(data.id)
      // A reload now reopens this draft rather than a blank new post.
      window.history.replaceState(null, '', `/posts/edit?id=${data.id}`)
      return 'saved'
    }

    if (liveStatus === 'published') {
      if (!versionRef.current.pending) {
        const { data, error: insertError } = await supabase
          .from('post_pending_edits')
          .insert({ ...fields, post_id: savedPostId })
          .select('updated_at')
          .single()
        // Already there: another tab saved a pending copy first.
        if (insertError?.code === '23505') return 'conflict'
        if (insertError) throw insertError
        versionRef.current.pending = data.updated_at
        setShowingPending(true)
        return 'saved'
      }
      const { data, error: updateError } = await supabase
        .from('post_pending_edits')
        .update(fields)
        .eq('post_id', savedPostId)
        .eq('updated_at', versionRef.current.pending)
        .select('updated_at')
      if (updateError) throw updateError
      if (data.length === 0) return 'conflict'
      versionRef.current.pending = data[0].updated_at
      return 'saved'
    }

    const { data, error: updateError } = await supabase
      .from('posts')
      .update(fields)
      .eq('id', savedPostId)
      .eq('updated_at', versionRef.current.post)
      .select('updated_at')
    if (updateError) throw updateError
    if (data.length === 0) return 'conflict'
    versionRef.current.post = data[0].updated_at
    // A draft with leftover pending changes (e.g. unpublished since) now
    // holds them itself.
    if (versionRef.current.pending) {
      await supabase.from('post_pending_edits').delete().eq('post_id', savedPostId)
      versionRef.current.pending = null
      setShowingPending(false)
    }
    return 'saved'
  }

  async function handleDiscardPending() {
    if (!window.confirm('Discard your unpublished changes and go back to the published version?')) return
    await autoSave.pause()
    const { error: discardError } = await supabase.from('post_pending_edits').delete().eq('post_id', savedPostId)
    if (discardError) {
      autoSave.resume()
      setError('Couldn’t discard the changes. Try again.')
      return
    }
    setTitle(post.title)
    setDescription(post.description ?? '')
    setThumbnailUrl(post.thumbnail_url)
    editor.commands.setContent(post.content)
    versionRef.current.pending = null
    setShowingPending(false)
    setError('')
    autoSave.markSaved(editSnapshot(post.title, post.description ?? '', editor.getHTML(), post.thumbnail_url))
    autoSave.resume()
  }

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
    // No auto-save while this runs (or after, as the page moves on).
    await autoSave.pause()
    const failed = (message) => {
      setSaving(false)
      setError(message)
      autoSave.resume()
    }

    const payload = {
      organization_id: organizationId,
      author_id: postId ? post.author_id : session.user.id,
      title: title.trim(),
      description: description.trim() || null,
      content: editor.getHTML(),
      status,
      thumbnail_url: thumbnailUrl,
      published_at: status === 'published' ? (post?.published_at ?? new Date().toISOString()) : null,
    }
    if (savedPostId) payload.id = savedPostId

    const { data, error: saveError } = await supabase
      .from('posts')
      .upsert(payload)
      .select('id, slug, updated_at')
      .single()

    if (saveError) {
      failed(saveError.message)
      return
    }

    const rowId = data.id
    versionRef.current.post = data.updated_at

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
        failed(tagError.message)
        return
      }
      setAuthorTags((current) => [...current, newTag])
      tagIds.push(newTag.id)
    }

    // Simplest correct sync: replace the full set rather than diffing --
    // category/tag counts on one post are always small.
    await supabase.from('post_categories').delete().eq('post_id', rowId)
    if (selectedCategoryIds.size > 0) {
      await supabase
        .from('post_categories')
        .insert([...selectedCategoryIds].map((category_id) => ({ post_id: rowId, category_id })))
    }

    if (isAuthor) {
      await supabase.from('post_tags').delete().eq('post_id', rowId)
      if (tagIds.length > 0) {
        await supabase.from('post_tags').insert(tagIds.map((tag_id) => ({ post_id: rowId, tag_id })))
      }
    }

    // What's saved now is the post itself, so any pending copy is done
    // with: it's been published, or saved as the draft.
    await supabase.from('post_pending_edits').delete().eq('post_id', rowId)
    versionRef.current.pending = null
    setShowingPending(false)
    autoSave.markSaved(editSnapshot(title, description, editor.getHTML(), thumbnailUrl))

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

  // Same direct-apply shape as handleGenerateImage. Asks first if it
  // would replace a description the author already wrote. Each press is
  // recorded as AI usage by the function itself (shown on /admin).
  async function handleWriteDescription() {
    if (!editor || editor.isEmpty) return
    if (description.trim() && !window.confirm('Replace your description with one written by AI?')) {
      return
    }
    setError('')
    setWritingDescription(true)

    const { data, error: describeError } = await supabase.functions.invoke('suggest-post-description', {
      body: { title: title.trim(), content: editor.getText() },
    })
    setWritingDescription(false)

    if (describeError || data?.error) {
      let reason = data?.error
      if (!reason && describeError?.context) {
        try {
          reason = (await describeError.context.json())?.error
        } catch {
          // context wasn't JSON, or already consumed -- fall through
        }
      }
      setError(
        reason === 'not_configured'
          ? 'Writing descriptions with AI isn’t configured yet.'
          : 'Couldn’t write a description. Try again.',
      )
      return
    }
    setDescription(data.description.slice(0, DESCRIPTION_MAX))
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

  // Opens the post as readers will see it, in another tab, without
  // saving anything: the current editor state is stashed in
  // localStorage and /posts/preview (PostPreview.jsx) renders it. The
  // named window target means a second click refreshes the same preview
  // tab instead of opening another.
  function handlePreview() {
    try {
      savePostPreview(previewId, {
        organizationName,
        post: {
          title: title.trim() || 'Untitled post',
          content: editor.getHTML(),
          thumbnail_url: thumbnailUrl,
          published_at: post?.published_at ?? new Date().toISOString(),
          categories: categories.filter((c) => selectedCategoryIds.has(c.id)).map((c) => c.name),
          tags: tagChips,
        },
      })
    } catch {
      setError('Couldn’t open the preview. Your browser may be blocking storage for this site.')
      return
    }
    setError('')
    window.open(`/posts/preview?id=${previewId}`, `post-preview-${previewId}`)
  }

  // Auto-save keeps everything up to the last save, so this only asks
  // when there are changes since then -- cancelling out of a blank form,
  // or right after a save, is instant. (A new post that's already been
  // auto-saved stays in My posts as a draft.)
  function handleCancel() {
    if (autoSave.isDirty() && !window.confirm('Leave without saving your latest changes?')) {
      return
    }
    autoSave.pause()
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
        {savedPostId ? 'Edit post' : 'New post'} — {organizationName}
      </h2>
      {showingPending && liveStatus === 'published' && (
        <div className="pending-edits-banner" role="note">
          <p>
            You&rsquo;re editing unpublished changes. Readers still see the published version until you click
            Publish.
          </p>
          <button type="button" className="secondary" onClick={handleDiscardPending}>
            Discard changes
          </button>
        </div>
      )}
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
        <label htmlFor="post-description">Description (optional)</label>
        <div className="description-row">
          <textarea
            id="post-description"
            className="post-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder="A sentence or two about this post"
            aria-describedby="post-description-hint"
          />
          {featureFlags.ai_description_generation && (
            <button
              type="button"
              className="ai-action-button"
              onClick={handleWriteDescription}
              disabled={writingDescription || isBodyEmpty}
              title={isBodyEmpty ? 'Write something in the body first' : 'Write a description based on the post'}
            >
              {writingDescription ? 'Writing…' : '✨ Write with AI'}
            </button>
          )}
        </div>
        <span id="post-description-hint" className="post-description-hint">
          <span>Used when you share the post — on LinkedIn and in link previews.</span>
          <span className="post-description-count">
            {description.length}/{DESCRIPTION_MAX}
          </span>
        </span>
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
      <AutoSaveStatus status={autoSave.status} pending={liveStatus === 'published'} />
      <div className="post-form-actions">
        <button type="button" className="secondary" disabled={saving} onClick={handleCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="secondary"
          disabled={isBodyEmpty && !title.trim()}
          title={isBodyEmpty && !title.trim() ? 'Write something first' : 'Open a preview in a new tab'}
          onClick={handlePreview}
        >
          Preview
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
