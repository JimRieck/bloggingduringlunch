import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './MyPosts.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function MyPosts({ organizationId, organizationName }) {
  const [posts, setPosts] = useState(null)

  useEffect(() => {
    supabase
      .from('posts')
      .select('id, title, status, published_at, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPosts(data ?? []))
  }, [organizationId])

  return (
    <main id="my-posts">
      <div className="my-posts-header">
        <h2>{organizationName}&rsquo;s posts</h2>
        <a className="link" href="/posts/new">
          Write a new post
        </a>
      </div>
      {posts === null ? (
        <p className="my-posts-status">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="my-posts-status">
          You haven&rsquo;t written anything yet.{' '}
          <a className="link" href="/posts/new">
            Start your first post
          </a>
          .
        </p>
      ) : (
        posts.map((post) => (
          <article className="post-summary" key={post.id}>
            <h2>
              {post.title}
              <span className={`status-badge status-${post.status}`}>{post.status}</span>
            </h2>
            <time dateTime={post.published_at ?? post.created_at}>
              {formatDate(post.published_at ?? post.created_at)}
            </time>
          </article>
        ))
      )}
    </main>
  )
}
