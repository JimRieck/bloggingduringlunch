import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './RecentPosts.css'

const POST_LIMIT = 20
const WINDOW_DAYS = 90

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function RecentPosts() {
  const [posts, setPosts] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const windowStart = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: postRows } = await supabase
        .from('posts')
        .select('id, title, slug, published_at, thumbnail_url, organization_id')
        .eq('status', 'published')
        .gte('published_at', windowStart)
        .order('published_at', { ascending: false })
        .limit(POST_LIMIT)

      if (cancelled) return

      const rows = postRows ?? []
      const orgIds = [...new Set(rows.map((p) => p.organization_id))]
      // Two-step fetch, not an embedded `organizations(...)` select: the
      // raw organizations table's RLS only allows a member to see their
      // own org, so an embed silently comes back null for every other
      // post and crashes the render (this bit the search page once).
      // organizations_public has no such restriction.
      const { data: orgRows } = orgIds.length
        ? await supabase.from('organizations_public').select('id, name, slug').in('id', orgIds)
        : { data: [] }
      const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]))

      if (cancelled) return
      setPosts(rows.map((p) => ({ ...p, organization: orgById.get(p.organization_id) })).filter((p) => p.organization))
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (posts === null) {
    return (
      <main id="recent-posts">
        <p className="recent-posts-status">Loading…</p>
      </main>
    )
  }

  if (posts.length === 0) {
    return (
      <main id="recent-posts">
        <p className="recent-posts-status">No posts published yet — check back soon.</p>
      </main>
    )
  }

  return (
    <main id="recent-posts">
      {posts.map((post) => (
        <article className="post-summary" key={post.id}>
          {post.thumbnail_url && <img src={post.thumbnail_url} alt="" className="post-thumbnail" />}
          <div className="recent-post-meta">
            <span>{post.organization.name}</span>
            <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
          </div>
          <h2>
            <a href={`/blog/${post.organization.slug}/${post.slug}`}>{post.title}</a>
          </h2>
        </article>
      ))}
    </main>
  )
}
