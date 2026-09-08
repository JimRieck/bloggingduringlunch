import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { getTenantUrl } from '../lib/tenant.js'
import { MyStats } from './MyStats.jsx'
import './MyPosts.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// navigator.clipboard requires a secure context and isn't available on
// every browser/device combination this site runs on -- falling back to
// the older execCommand approach covers those cases.
async function copyToClipboard(text) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy approach below
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    document.execCommand('copy')
    return true
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

export function MyPosts({ organizationId, organizationName, organizationSlug, viewerRole }) {
  const [posts, setPosts] = useState(null)
  const [stats, setStats] = useState({})
  const [copiedId, setCopiedId] = useState(null)
  const [error, setError] = useState('')
  const canDelete = viewerRole === 'owner' || viewerRole === 'admin'

  useEffect(() => {
    supabase
      .from('posts')
      .select('id, title, slug, status, published_at, created_at, thumbnail_url')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setPosts(data ?? []))
  }, [organizationId])

  useEffect(() => {
    if (!posts || posts.length === 0) return
    const postIds = posts.map((p) => p.id)

    // post_views/post_comments have no public count endpoint -- fetch the
    // rows and tally client-side. post_rating_summary is already an
    // aggregate view, so that one comes back pre-counted.
    Promise.all([
      supabase.from('post_views').select('post_id').in('post_id', postIds),
      supabase.from('post_rating_summary').select('post_id, average_rating, rating_count').in('post_id', postIds),
      supabase.from('post_comments').select('post_id').in('post_id', postIds),
    ]).then(([{ data: views }, { data: ratings }, { data: comments }]) => {
      const viewCounts = new Map()
      for (const v of views ?? []) viewCounts.set(v.post_id, (viewCounts.get(v.post_id) ?? 0) + 1)

      const commentCounts = new Map()
      for (const c of comments ?? []) commentCounts.set(c.post_id, (commentCounts.get(c.post_id) ?? 0) + 1)

      const ratingByPost = new Map((ratings ?? []).map((r) => [r.post_id, r]))

      const next = {}
      for (const id of postIds) {
        next[id] = {
          views: viewCounts.get(id) ?? 0,
          commentCount: commentCounts.get(id) ?? 0,
          averageRating: ratingByPost.get(id)?.average_rating ?? null,
          ratingCount: ratingByPost.get(id)?.rating_count ?? 0,
        }
      }
      setStats(next)
    })
  }, [posts])

  async function handleCopyLink(post) {
    const ok = await copyToClipboard(getTenantUrl(organizationSlug, post.slug))
    if (ok) {
      setCopiedId(post.id)
      setTimeout(() => setCopiedId((id) => (id === post.id ? null : id)), 2000)
    }
  }

  async function handleUnpublish(post) {
    setError('')
    const { error: updateError } = await supabase
      .from('posts')
      .update({ status: 'draft', published_at: null })
      .eq('id', post.id)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setPosts((current) =>
      current.map((p) => (p.id === post.id ? { ...p, status: 'draft', published_at: null } : p)),
    )
  }

  async function handleDelete(post) {
    if (!window.confirm(`Delete "${post.title}"? This can’t be undone.`)) return
    setError('')
    const { error: deleteError, count } = await supabase
      .from('posts')
      .delete({ count: 'exact' })
      .eq('id', post.id)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    if (!count) {
      setError('Only this blog’s owner can delete posts.')
      return
    }
    setPosts((current) => current.filter((p) => p.id !== post.id))
  }

  return (
    <main id="my-posts">
      <div className="my-posts-header">
        <h2>{organizationName}&rsquo;s posts</h2>
        <a className="link" href="/posts/new">
          Write a new post
        </a>
      </div>
      <MyStats posts={posts} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
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
          <article className="post-summary my-post" key={post.id}>
            {post.thumbnail_url && (
              <img src={post.thumbnail_url} alt="" className="my-post-thumbnail" />
            )}
            <div>
              <h2>
                {post.title}
                <span className={`status-badge status-${post.status}`}>{post.status}</span>
              </h2>
              <time dateTime={post.published_at ?? post.created_at}>
                {formatDate(post.published_at ?? post.created_at)}
              </time>
              {post.status === 'published' && (
                <p className="post-stats">
                  {stats[post.id]?.views ?? 0} view{stats[post.id]?.views === 1 ? '' : 's'}
                  {' · '}
                  {stats[post.id]?.ratingCount
                    ? `${stats[post.id].averageRating} ★ (${stats[post.id].ratingCount})`
                    : 'No ratings yet'}
                  {' · '}
                  {stats[post.id]?.commentCount ?? 0} comment{stats[post.id]?.commentCount === 1 ? '' : 's'}
                </p>
              )}
              <a className="icon-action" href={`/posts/edit?id=${post.id}`} title="Edit this post">
                <img src="/icons/edit.svg" alt="Edit this post" />
              </a>
              {post.status === 'published' && (
                <>
                  <a
                    className="icon-action"
                    href={getTenantUrl(organizationSlug, post.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="View this post (opens in a new tab)"
                  >
                    <img src="/icons/external-link.svg" alt="View this post (opens in a new tab)" />
                  </a>
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => handleCopyLink(post)}
                    title="Copy link to this post"
                  >
                    <img
                      src="/icons/copy-link.svg"
                      alt={copiedId === post.id ? 'Link copied' : 'Copy link to this post'}
                    />
                  </button>
                  {copiedId === post.id && <span className="copy-feedback">Copied!</span>}
                  <button
                    type="button"
                    className="icon-action"
                    onClick={() => handleUnpublish(post)}
                    title="Unpublish this post"
                  >
                    <img src="/icons/unpublish.svg" alt="Unpublish this post" />
                  </button>
                </>
              )}
              {canDelete && (
                <button
                  type="button"
                  className="icon-action"
                  onClick={() => handleDelete(post)}
                  title="Delete this post"
                >
                  <img src="/icons/trash.svg" alt="Delete this post" />
                </button>
              )}
            </div>
          </article>
        ))
      )}
    </main>
  )
}
