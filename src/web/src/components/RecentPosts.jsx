import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Avatar } from './Avatar.jsx'
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
        .select('id, title, slug, published_at, thumbnail_url, organization_id, author_id')
        .eq('status', 'published')
        .gte('published_at', windowStart)
        .order('published_at', { ascending: false })
        .limit(POST_LIMIT)

      if (cancelled) return

      const rows = postRows ?? []
      const orgIds = [...new Set(rows.map((p) => p.organization_id))]
      const authorIds = [...new Set(rows.map((p) => p.author_id))]
      // Two-step fetches, not embedded `organizations(...)`/`profiles(...)`
      // selects: the raw tables' RLS only allows a member/the owning user
      // to see their own row, so an embed silently comes back null for
      // every other post and crashes the render (this bit the search page
      // once). organizations_public/public_profiles have no such
      // restriction and are safe to read anonymously.
      const [{ data: orgRows }, { data: authorRows }] = await Promise.all([
        orgIds.length
          ? supabase.from('organizations_public').select('id, name, slug').in('id', orgIds)
          : Promise.resolve({ data: [] }),
        authorIds.length
          ? supabase.from('public_profiles').select('id, display_name, avatar_url').in('id', authorIds)
          : Promise.resolve({ data: [] }),
      ])
      const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]))
      const authorById = new Map((authorRows ?? []).map((a) => [a.id, a]))

      if (cancelled) return
      setPosts(
        rows
          .map((p) => ({ ...p, organization: orgById.get(p.organization_id), author: authorById.get(p.author_id) }))
          .filter((p) => p.organization)
      )
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
          {post.thumbnail_url && (
            <div className="post-thumbnail-frame">
              <img src={post.thumbnail_url} alt="" className="post-thumbnail" />
            </div>
          )}
          <div className="recent-post-byline">
            <Avatar url={post.author?.avatar_url} label={post.author?.display_name} />
            <span>By {post.author?.display_name || 'Unknown author'}</span>
          </div>
          <h2>
            <a href={`/blog/${post.organization.slug}/${post.slug}`}>{post.title}</a>
          </h2>
          <div className="recent-post-meta">
            <span>{post.organization.name}</span>
            <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
          </div>
        </article>
      ))}
    </main>
  )
}
