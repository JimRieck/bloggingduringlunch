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
const DEFAULT_POST_LIMIT = 20
const DEFAULT_WINDOW_DAYS = 90

const POST_COLUMNS = 'id, title, slug, published_at, thumbnail_url, organization_id, author_id'

// The reusable search component -- used by the gated /search page
// (Search.jsx, a thin wrapper around this) and directly as the logged-out
// landing page's main content (App.jsx), in place of RecentPosts. `wide`
// switches the post-results grid from the narrow single-panel layout to
// RecentPosts' own full-width 3/2/1-column layout for that second case.
export function SearchBox({ autoFocus = false, wide = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [defaultPosts, setDefaultPosts] = useState(null)

  // Browsed by default (no query yet), same window/limit RecentPosts.jsx
  // uses on the main page, so search "just works" as a browse view too.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const windowStart = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: postRows } = await supabase
        .from('posts')
        .select(POST_COLUMNS)
        .eq('status', 'published')
        .gte('published_at', windowStart)
        .order('published_at', { ascending: false })
        .limit(DEFAULT_POST_LIMIT)
      if (cancelled) return
      const withMeta = await attachPostMeta(postRows ?? [])
      if (cancelled) return
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

      setResults({
        authors: authors.data ?? [],
        orgs: orgs.data ?? [],
        posts: postsWithMeta.map((p) => ({
          ...p,
          matchedVia: titlePostIds.has(p.id) ? null : matchLabelByPostId.get(p.id),
        })),
      })
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
          // Cleared right here, in the event that caused it, rather
          // than reactively in the effect below -- the effect only
          // ever needs to decide whether to fetch, not reset state.
          if (value.trim().length < MIN_QUERY_LENGTH) setResults(null)
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
          <h3>Recent posts</h3>
          {defaultPosts === null ? (
            <p className="search-status">Loading…</p>
          ) : defaultPosts.length === 0 ? (
            <p className="search-status">No posts published in the last {DEFAULT_WINDOW_DAYS} days.</p>
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
