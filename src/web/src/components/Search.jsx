import { useEffect, useState } from 'react'
import { Avatar } from './Avatar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { getTenantUrl } from '../lib/tenant.js'
import './Search.css'

const MIN_QUERY_LENGTH = 2
const RESULT_LIMIT = 10

export function Search() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) return

    let cancelled = false
    const timer = setTimeout(async () => {
      const like = `%${trimmed}%`
      const [authors, orgs, posts] = await Promise.all([
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
      ])
      if (cancelled) return

      // Posts can't embed `organizations` directly -- that table's RLS
      // only allows a member to see their own org, so a post whose
      // author is in a different org than the searcher would silently
      // come back with organizations: null and crash the render.
      // organizations_public has no such restriction; join client-side.
      const postRows = posts.data ?? []
      const orgIds = [...new Set(postRows.map((p) => p.organization_id))]
      const { data: postOrgs } = orgIds.length
        ? await supabase.from('organizations_public').select('id, name, slug').in('id', orgIds)
        : { data: [] }
      const orgById = new Map((postOrgs ?? []).map((o) => [o.id, o]))

      if (cancelled) return
      setResults({
        authors: authors.data ?? [],
        orgs: orgs.data ?? [],
        posts: postRows.map((p) => ({ ...p, organization: orgById.get(p.organization_id) })),
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
    <main id="search-page">
      <h2>Search</h2>
      <input
        type="search"
        className="search-input"
        placeholder="Search authors, blogs, or post titles…"
        value={query}
        onChange={(e) => {
          const value = e.target.value
          setQuery(value)
          // Cleared right here, in the event that caused it, rather
          // than reactively in the effect below -- the effect only
          // ever needs to decide whether to fetch, not reset state.
          if (value.trim().length < MIN_QUERY_LENGTH) setResults(null)
        }}
        autoFocus
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
            <a className="search-result" href={`/blog/${org.slug}`} target="_blank" rel="noopener noreferrer" key={org.id}>
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
                  <div className="search-result-meta">{post.organization.name}</div>
                </div>
              </a>
            ) : null,
          )}
        </section>
      )}
    </main>
  )
}
