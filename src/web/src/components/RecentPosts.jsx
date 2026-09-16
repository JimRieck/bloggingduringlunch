import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { attachPostMeta } from '../lib/postMeta.js'
import { PostCard } from './PostCard.jsx'
import './RecentPosts.css'

const POST_LIMIT = 20
const WINDOW_DAYS = 90

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
      const withMeta = await attachPostMeta(postRows ?? [])
      if (cancelled) return
      setPosts(withMeta)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (posts === null) {
    return (
      <main id="recent-posts" className="post-grid">
        <p className="recent-posts-status">Loading…</p>
      </main>
    )
  }

  if (posts.length === 0) {
    return (
      <main id="recent-posts" className="post-grid">
        <p className="recent-posts-status">No posts published yet — check back soon.</p>
      </main>
    )
  }

  return (
    <main id="recent-posts" className="post-grid">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} href={`/blog/${post.organization.slug}/${post.slug}`} />
      ))}
    </main>
  )
}
