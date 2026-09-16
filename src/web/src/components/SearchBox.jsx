import { useEffect, useState } from 'react'
import { Avatar } from './Avatar.jsx'
import { PostCard } from './PostCard.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { attachPostMeta } from '../lib/postMeta.js'
import { getTenantUrl } from '../lib/tenant.js'
import './SearchBox.css'
import './RecentPosts.css'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 10
// Bounds how many distinct searches stay cached at once -- FIFO eviction
// via Map's insertion-order iteration, just enough to stop unbounded
// growth in a long session without needing a real LRU for something this
// small.
const SEARCH_CACHE_LIMIT = 50

const POST_COLUMNS = 'id, title, slug, published_at, thumbnail_url, organization_id, author_id'

// Module-level, not component state, for the same reason as postMeta.js's
// caches: every post across the whole site is now loaded for the default
// browse view (no more 90-day window/20-post cap), so it's worth fetching
// once per page load and reusing across remounts rather than re-querying
// every time the component mounts.
let defaultPostsCache = null

// Keyed by the normalized (trimmed, lowercased) query string -- typing
// "react", backspacing to "reac", then retyping "react" hits this
// instead of re-running the whole multi-table search again. This is
// what "caching mechanism" mainly refers to here; the org/author lookup
// cache in postMeta.js is the other half of it.
const searchCache = new Map()

// The reusable search component -- used by the gated /search page
// (Search.jsx, a thin wrapper around this) and directly as the logged-out
// landing page's main content (App.jsx), in place of RecentPosts. `wide`
// switches the post-results grid from the narrow single-panel layout to
// RecentPosts' own full-width 3/2/1-column layout for that second case.
export function SearchBox({ autoFocus = false, wide = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [defaultPosts, setDefaultPosts] = useState(defaultPostsCache)

  // Every published post across every author/org -- browsed by default
  // (no query yet), so search doubles as a full browse view too.
  useEffect(() => {
    if (defaultPostsCache) return
    let cancelled = false
    async function load() {
      const { data: postRows } = await supabase
        .from('posts')
        .select(POST_COLUMNS)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
      if (cancelled) return
      const withMeta = await attachPostMeta(postRows ?? [])
      if (cancelled) return
      defaultPostsCache = withMeta
      setDefaultPosts(withMeta)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) return

    const cacheKey = trimmed.toLowerCase()
    // A cache hit is already reflected in `results` synchronously, from
    // the onChange handler below -- nothing left to do here.
    if (searchCache.has(cacheKey)) return

    let cancelled = false
    const timer = setTimeout(async () => {
      const like = `%${trimmed}%`
      const [authors, orgs, titleMatches, categoryMatches, tagMatches] = await Promise.all([
        supabase
          .from('user_directory')
          .select('id, display_name, avatar_url, organizations')
          .eq('user_type', 'author')
          .ilike('display_name', like)
          .limit(RESULT_LIMIT),
        supabase.from('organizations_public').select('id, name, slug').ilike('name', like).limit(RESULT_LIMIT),
        supabase
          .from('posts')
          .select(POST_COLUMNS)
          .eq('status', 'published')
          .ilike('title', like)
          .order('published_at', { ascending: false })
          .limit(RESULT_LIMIT),
        supabase.from('categories').select('id, name').ilike('name', like).limit(RESULT_LIMIT),
        supabase.from('tags').select('id, name').ilike('name', like).limit(RESULT_LIMIT),
      ])
      if (cancelled) return

      // There's no per-tag/per-category archive page in this app, so a
      // tag/category match just surfaces the post(s) it's attached to,
      // folded into the same "Posts" results a title match populates --
      // two-step fetch, not an embed, same reasoning as TenantBlog.jsx's
      // loadCategoriesAndTags (post_categories/post_tags carry their own
      // RLS independent of categories/tags itself).
      const categoryIds = (categoryMatches.data ?? []).map((c) => c.id)
      const tagIds = (tagMatches.data ?? []).map((t) => t.id)
      const [catLinks, tagLinks] = await Promise.all([
        categoryIds.length
          ? supabase.from('post_categories').select('post_id, category_id').in('category_id', categoryIds)
          : Promise.resolve({ data: [] }),
        tagIds.length
          ? supabase.from('post_tags').select('post_id, tag_id').in('tag_id', tagIds)
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return

      const categoryNameById = new Map((categoryMatches.data ?? []).map((c) => [c.id, c.name]))
      const tagNameById = new Map((tagMatches.data ?? []).map((t) => [t.id, t.name]))
      const matchLabelByPostId = new Map()
      for (const link of catLinks.data ?? []) {
        if (!matchLabelByPostId.has(link.post_id)) {
          matchLabelByPostId.set(link.post_id, categoryNameById.get(link.category_id))
        }
      }
      for (const link of tagLinks.data ?? []) {
        if (!matchLabelByPostId.has(link.post_id)) {
          matchLabelByPostId.set(link.post_id, `#${tagNameById.get(link.tag_id)}`)
        }
      }

      const titlePostIds = new Set((titleMatches.data ?? []).map((p) => p.id))
      const extraPostIds = [...matchLabelByPostId.keys()].filter((id) => !titlePostIds.has(id))
      const { data: extraPosts } = extraPostIds.length
        ? await supabase.from('posts').select(POST_COLUMNS).eq('status', 'published').in('id', extraPostIds)
        : { data: [] }
      if (cancelled) return

      const mergedPosts = [...(titleMatches.data ?? []), ...(extraPosts ?? [])].sort(
        (a, b) => new Date(b.published_at) - new Date(a.published_at),
      )
      const postsWithMeta = await attachPostMeta(mergedPosts)
      if (cancelled) return

      const resultsForQuery = {
        authors: authors.data ?? [],
        orgs: orgs.data ?? [],
        posts: postsWithMeta.map((p) => ({
          ...p,
          matchedVia: titlePostIds.has(p.id) ? null : matchLabelByPostId.get(p.id),
        })),
      }

      if (searchCache.size >= SEARCH_CACHE_LIMIT) {
        searchCache.delete(searchCache.keys().next().value)
      }
      searchCache.set(cacheKey, resultsForQuery)
      setResults(resultsForQuery)
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const showEmptyState =
    results && results.authors.length === 0 && results.orgs.length === 0 && results.posts.length === 0

  return (
    <div className={wide ? 'search-box search-box-wide' : 'search-box'}>
      <input
        type="search"
        className="search-input"
        placeholder="Search authors, blogs, tags, categories, or post titles…"
        value={query}
        onChange={(e) => {
          const value = e.target.value
          setQuery(value)
          // Both branches update state right here, in the event that
          // caused them, rather than reactively in the effect below --
          // that effect's only job left is the debounced network fetch
          // for an actual cache miss.
          const trimmed = value.trim()
          if (trimmed.length < MIN_QUERY_LENGTH) {
            setResults(null)
            return
          }
          const cached = searchCache.get(trimmed.toLowerCase())
          if (cached) setResults(cached)
        }}
        autoFocus={autoFocus}
      />

      {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
        <p className="search-status">Keep typing…</p>
      )}

      {showEmptyState && <p className="search-status">No results for &ldquo;{query.trim()}&rdquo;.</p>}

      {results && results.authors.length > 0 && (
        <section className="search-section">
          <h3>Authors</h3>
          {results.authors.map((author) => (
            <div className="search-result" key={author.id}>
              <Avatar url={author.avatar_url} label={author.display_name} />
              <div>
                <div className="search-result-title">{author.display_name}</div>
                <div className="search-result-meta">{author.organizations}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {results && results.orgs.length > 0 && (
        <section className="search-section">
          <h3>Blogs</h3>
          {results.orgs.map((org) => (
            <a
              className="search-result"
              href={`/blog/${org.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              key={org.id}
            >
              <div>
                <div className="search-result-title">{org.name}</div>
                <div className="search-result-meta">{`/blog/${org.slug}`}</div>
              </div>
            </a>
          ))}
        </section>
      )}

      {results && results.posts.length > 0 && (
        <section className="search-section">
          <h3>Posts</h3>
          <div className="post-grid search-post-grid">
            {results.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                href={getTenantUrl(post.organization.slug, post.slug)}
                newTab
                note={post.matchedVia ? `matched: ${post.matchedVia}` : null}
              />
            ))}
          </div>
        </section>
      )}

      {!results && (
        <section className="search-section">
          <h3>All posts</h3>
          {defaultPosts === null ? (
            <p className="search-status">Loading…</p>
          ) : defaultPosts.length === 0 ? (
            <p className="search-status">No posts published yet.</p>
          ) : (
            <div className="post-grid search-post-grid">
              {defaultPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  href={getTenantUrl(post.organization.slug, post.slug)}
                  newTab
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
