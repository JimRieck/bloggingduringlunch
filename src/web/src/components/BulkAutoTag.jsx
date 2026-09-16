import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { resolveCategoryIds, resolveTagIds } from '../lib/taxonomy.js'
import { CircularProgress } from './CircularProgress.jsx'
import './BulkAutoTag.css'

// Two-step fetch, not an embed -- same reasoning as TenantBlog.jsx's own
// loadCategoriesAndTags: post_categories/post_tags carry their own RLS
// independent of categories/tags itself.
async function loadCategoriesAndTags(postIds) {
  if (postIds.length === 0) return { categoriesByPost: new Map(), tagsByPost: new Map() }

  const [{ data: catLinks }, { data: tagLinks }] = await Promise.all([
    supabase.from('post_categories').select('post_id, category_id').in('post_id', postIds),
    supabase.from('post_tags').select('post_id, tag_id').in('post_id', postIds),
  ])

  const categoryIds = [...new Set((catLinks ?? []).map((r) => r.category_id))]
  const tagIds = [...new Set((tagLinks ?? []).map((r) => r.tag_id))]
  const [{ data: categoryRows }, { data: tagRows }] = await Promise.all([
    categoryIds.length ? supabase.from('categories').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [] }),
    tagIds.length ? supabase.from('tags').select('id, name').in('id', tagIds) : Promise.resolve({ data: [] }),
  ])
  const categoryById = new Map((categoryRows ?? []).map((c) => [c.id, c]))
  const tagById = new Map((tagRows ?? []).map((t) => [t.id, t]))

  const categoriesByPost = new Map()
  for (const link of catLinks ?? []) {
    const c = categoryById.get(link.category_id)
    if (!c) continue
    categoriesByPost.set(link.post_id, [...(categoriesByPost.get(link.post_id) ?? []), c])
  }
  const tagsByPost = new Map()
  for (const link of tagLinks ?? []) {
    const t = tagById.get(link.tag_id)
    if (!t) continue
    tagsByPost.set(link.post_id, [...(tagsByPost.get(link.post_id) ?? []), t])
  }
  return { categoriesByPost, tagsByPost }
}

export function BulkAutoTag({ session }) {
  const [posts, setPosts] = useState(null)
  const [authorTags, setAuthorTags] = useState([])
  const [categoriesByOrg, setCategoriesByOrg] = useState(new Map())
  const [rowStatus, setRowStatus] = useState({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const stopRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: rows } = await supabase
        .from('posts')
        .select('id, title, slug, content, status, organization_id')
        .eq('author_id', session.user.id)
        .order('created_at', { ascending: false })
      if (cancelled) return
      const rowsList = rows ?? []

      const [{ categoriesByPost, tagsByPost }, { data: tagRows }] = await Promise.all([
        loadCategoriesAndTags(rowsList.map((p) => p.id)),
        supabase.from('tags').select('id, name').eq('author_id', session.user.id),
      ])
      if (cancelled) return

      const orgIds = [...new Set(rowsList.map((p) => p.organization_id))]
      const { data: categoryRows } = orgIds.length
        ? await supabase.from('categories').select('id, name, organization_id').in('organization_id', orgIds)
        : { data: [] }
      if (cancelled) return

      const byOrg = new Map()
      for (const c of categoryRows ?? []) {
        byOrg.set(c.organization_id, [...(byOrg.get(c.organization_id) ?? []), c])
      }

      setCategoriesByOrg(byOrg)
      setAuthorTags(tagRows ?? [])
      setPosts(
        rowsList.map((p) => ({
          ...p,
          categories: categoriesByPost.get(p.id) ?? [],
          tags: tagsByPost.get(p.id) ?? [],
        })),
      )
    }
    load()
    return () => {
      cancelled = true
    }
  }, [session.user.id])

  // Additive only -- never removes a category/tag that's already
  // attached, so this is safe to run without a per-post review step
  // (the "as easy as clicking a button" bulk mode). Returns false on
  // failure so callers can tally it without throwing mid-batch.
  async function autoTagOne(post) {
    setRowStatus((s) => ({ ...s, [post.id]: 'working' }))

    const existingCategories = categoriesByOrg.get(post.organization_id) ?? []
    const { data, error: suggestError } = await supabase.functions.invoke('suggest-tags-and-categories', {
      body: {
        title: post.title,
        content: (post.content || '').replace(/<[^>]+>/g, ' '),
        existingCategories: existingCategories.map((c) => c.name),
        existingTags: authorTags.map((t) => t.name),
      },
    })
    if (suggestError || data?.error) {
      setRowStatus((s) => ({ ...s, [post.id]: 'error' }))
      return false
    }

    const existingCategoryIds = new Set(post.categories.map((c) => c.id))
    const existingTagIds = new Set(post.tags.map((t) => t.id))

    const categoriesCopy = [...existingCategories]
    const newCategoryIds = (
      await resolveCategoryIds(data.categories ?? [], post.organization_id, categoriesCopy)
    ).filter((id) => !existingCategoryIds.has(id))

    const tagsCopy = [...authorTags]
    const newTagIds = (await resolveTagIds(data.tags ?? [], session.user.id, tagsCopy)).filter(
      (id) => !existingTagIds.has(id),
    )

    if (newCategoryIds.length > 0) {
      await supabase
        .from('post_categories')
        .insert(newCategoryIds.map((category_id) => ({ post_id: post.id, category_id })))
    }
    if (newTagIds.length > 0) {
      await supabase.from('post_tags').insert(newTagIds.map((tag_id) => ({ post_id: post.id, tag_id })))
    }

    setCategoriesByOrg((current) => new Map(current).set(post.organization_id, categoriesCopy))
    setAuthorTags(tagsCopy)

    const addedCategories = categoriesCopy.filter((c) => newCategoryIds.includes(c.id))
    const addedTags = tagsCopy.filter((t) => newTagIds.includes(t.id))
    setPosts((current) =>
      current.map((p) =>
        p.id === post.id
          ? { ...p, categories: [...p.categories, ...addedCategories], tags: [...p.tags, ...addedTags] }
          : p,
      ),
    )
    setRowStatus((s) => ({ ...s, [post.id]: 'done' }))
    return true
  }

  async function handleAutoTagOne(post) {
    setError('')
    await autoTagOne(post)
  }

  async function handleAutoTagAll() {
    setError('')
    setRunning(true)
    stopRef.current = false
    setProgress({ done: 0, total: posts.length })

    let failed = 0
    for (const post of posts) {
      if (stopRef.current) break
      const ok = await autoTagOne(post)
      if (!ok) failed += 1
      setProgress((prog) => ({ done: (prog?.done ?? 0) + 1, total: posts.length }))
    }

    setRunning(false)
    setProgress(null)
    if (failed > 0) {
      setError(`${failed} post${failed === 1 ? '' : 's'} couldn’t be auto-tagged. Try those individually.`)
    }
  }

  function handleStop() {
    stopRef.current = true
  }

  return (
    <main id="bulk-auto-tag">
      <div className="bulk-auto-tag-header">
        <div>
          <h2>Auto-tag posts</h2>
          <p className="bulk-auto-tag-intro">
            Suggests categories and tags for each post below with AI, based on what it&rsquo;s about. Only ever
            adds to what&rsquo;s already there &mdash; nothing existing is removed.
          </p>
        </div>
        {posts && posts.length > 0 && (
          <button type="button" className="primary" disabled={running} onClick={running ? handleStop : handleAutoTagAll}>
            {running ? (
              <span className="bulk-auto-tag-progress">
                <CircularProgress value={progress?.done ?? 0} max={progress?.total ?? 1} />
                {progress ? `${progress.done} of ${progress.total} — Stop` : 'Working…'}
              </span>
            ) : (
              'Auto-fill all'
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {posts === null ? (
        <p className="bulk-auto-tag-status">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="bulk-auto-tag-status">You haven&rsquo;t written anything yet.</p>
      ) : (
        posts.map((post) => (
          <article className="post-summary bulk-auto-tag-row" key={post.id}>
            <div className="bulk-auto-tag-row-main">
              <h2>
                {post.title}
                <span className={`status-badge status-${post.status}`}>{post.status}</span>
              </h2>
              {(post.categories.length > 0 || post.tags.length > 0) && (
                <div className="post-taxonomy">
                  {post.categories.map((c) => (
                    <span className="post-category-badge" key={c.id}>
                      {c.name}
                    </span>
                  ))}
                  {post.tags.map((t) => (
                    <span className="post-tag-badge" key={t.id}>
                      #{t.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="link"
              disabled={rowStatus[post.id] === 'working' || running}
              onClick={() => handleAutoTagOne(post)}
            >
              {rowStatus[post.id] === 'working'
                ? 'Suggesting…'
                : rowStatus[post.id] === 'error'
                  ? 'Failed — retry'
                  : rowStatus[post.id] === 'done'
                    ? '✨ Auto-fill again'
                    : '✨ Auto-fill'}
            </button>
          </article>
        ))
      )}
    </main>
  )
}
