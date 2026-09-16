import { useEffect, useState } from 'react'
import { Avatar } from './Avatar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { getTenantUrl } from '../lib/tenant.js'
import './SearchBox.css'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 10

// The reusable search component -- used both by the gated /search page
// (Search.jsx, a thin wrapper around this) and embedded directly on the
// logged-out landing page via LandingNav's "Search" tab.
export function SearchBox({ autoFocus = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)

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
          .select('id, title, slug, published_at, organization_id')
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
        ? await supabase
            .from('posts')
            .select('id, title, slug, published_at, organization_id')
            .eq('status', 'published')
            .in('id', extraPostIds)
        : { data: [] }
      if (cancelled) return

      const allPosts = [...(titleMatches.data ?? []), ...(extraPosts ?? [])].sort(
        (a, b) => new Date(b.published_at) - new Date(a.published_at),
      )

      // Posts can't embed `organizations` directly -- that table's RLS
      // only allows a member to see their own org, so a post whose
      // author is in a different org than the searcher would silently
      // come back with organizations: null and crash the render.
      // organizations_public has no such restriction; join client-side.
      const orgIds = [...new Set(allPosts.map((p) => p.organization_id))]
      const { data: postOrgs } = orgIds.length
        ? await supabase.from('organizations_public').select('id, name, slug').in('id', orgIds)
        : { data: [] }
      const orgById = new Map((postOrgs ?? []).map((o) => [o.id, o]))

      if (cancelled) return
      setResults({
        authors: authors.data ?? [],
        orgs: orgs.data ?? [],
        posts: allPosts.map((p) => ({
          ...p,
          organization: orgById.get(p.organization_id),
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
    <div className="search-box">
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
          {results.posts.map((post) =>
            post.organization ? (
              <a
                className="search-result"
                href={getTenantUrl(post.organization.slug, post.slug)}
                target="_blank"
                rel="noopener noreferrer"
                key={post.id}
              >
                <div>
                  <div className="search-result-title">{post.title}</div>
                  <div className="search-result-meta">
                    {post.organization.name}
                    {post.matchedVia && <span className="search-match-badge">matched: {post.matchedVia}</span>}
                  </div>
                </div>
              </a>
            ) : null,
          )}
        </section>
      )}
    </div>
  )
}
