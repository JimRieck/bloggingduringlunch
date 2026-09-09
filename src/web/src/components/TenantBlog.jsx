import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabaseClient.js'
import { StarRating } from './StarRating.jsx'
import { CommentSection } from './CommentSection.jsx'
import './TenantBlog.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function TenantBlog({ slug, postSlug, session }) {
  const [status, setStatus] = useState('loading')
  const [organization, setOrganization] = useState(null)
  const [posts, setPosts] = useState([])
  const [post, setPost] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: org } = await supabase
        .from('organizations_public')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle()

      if (cancelled) return
      if (!org) {
        setStatus('not-found')
        return
      }
      setOrganization(org)

      if (postSlug) {
        const { data: onePost } = await supabase
          .from('posts')
          .select('id, title, slug, content, published_at, thumbnail_url, author_id')
          .eq('organization_id', org.id)
          .eq('slug', postSlug)
          .eq('status', 'published')
          .maybeSingle()

        if (cancelled) return
        if (!onePost) {
          setStatus('post-not-found')
          return
        }
        setPost(onePost)
        setStatus('ready')
        // Don't count the author's own visits -- RLS also enforces this
        // (see 20260908203258_exclude_author_from_post_views.sql), this
        // just skips the doomed request. Deliberately re-checks the
        // live session here instead of trusting the `session` prop:
        // App.jsx's own session fetch is async and starts out null on
        // first paint, so on a fresh page load (as opposed to
        // client-side nav from an already-logged-in state) the prop
        // can still be stale by the time this effect runs, which
        // let a real author's view request through and rely on RLS to
        // reject it rather than skipping it client-side as intended.
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession()
        if (cancelled) return
        if (currentSession?.user?.id !== onePost.author_id) {
          // supabase-js query builders are lazy thenables -- the request
          // never fires unless awaited/then'd, even for a fire-and-forget
          // insert like this one.
          await supabase.from('post_views').insert({ post_id: onePost.id, referrer: document.referrer || null })
        }
        return
      }

      const { data: orgPosts } = await supabase
        .from('posts')
        .select('title, slug, content, published_at, thumbnail_url')
        .eq('organization_id', org.id)
        .eq('status', 'published')
        .order('published_at', { ascending: false })

      if (cancelled) return
      setPosts(orgPosts ?? [])
      setStatus('ready')
    }

    load()
    return () => {
      cancelled = true
    }
  }, [slug, postSlug])

  if (status === 'loading') {
    return (
      <div id="tenant-blog" className="tenant-status">
        <p>Loading…</p>
      </div>
    )
  }

  if (status === 'not-found') {
    return (
      <div id="tenant-blog" className="tenant-status">
        <a className="tenant-home-link" href="/">
          ← Blogging During Lunch
        </a>
        <h1>Blog not found</h1>
        <p>There&rsquo;s no blog at this address.</p>
      </div>
    )
  }

  if (status === 'post-not-found') {
    return (
      <div id="tenant-blog" className="tenant-status">
        <a className="tenant-home-link" href="/">
          ← Blogging During Lunch
        </a>
        <h1>Post not found</h1>
        <p>
          There&rsquo;s no post at this address. <a href={`/blog/${slug}`}>View {organization.name}&rsquo;s blog →</a>
        </p>
      </div>
    )
  }

  if (postSlug && post) {
    return (
      <div id="tenant-blog">
        <header id="tenant-header">
          <a className="tenant-home-link" href="/">
            ← Blogging During Lunch
          </a>
          <h1>{organization.name}</h1>
        </header>
        <main id="tenant-posts">
          <article className="post-summary">
            {post.thumbnail_url && (
              <img src={post.thumbnail_url} alt="" className="post-thumbnail" />
            )}
            <h2>{post.title}</h2>
            <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
            <div
              className="post-body"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content) }}
            />
            <StarRating postId={post.id} session={session} />
            <CommentSection postId={post.id} session={session} />
          </article>
          <a className="link" href={`/blog/${slug}`}>
            ← All posts from {organization.name}
          </a>
        </main>
      </div>
    )
  }

  return (
    <div id="tenant-blog">
      <header id="tenant-header">
        <a className="tenant-home-link" href="/">
          ← Blogging During Lunch
        </a>
        <h1>{organization.name}</h1>
      </header>
      <main id="tenant-posts">
        {posts.length === 0 ? (
          <p className="tenant-empty">No posts published yet.</p>
        ) : (
          posts.map((p) => (
            <article className="post-summary" id={p.slug} key={p.slug}>
              {p.thumbnail_url && <img src={p.thumbnail_url} alt="" className="post-thumbnail" />}
              <h2>
                <a href={`/blog/${slug}/${p.slug}`}>{p.title}</a>
              </h2>
              <time dateTime={p.published_at}>{formatDate(p.published_at)}</time>
              <div
                className="post-body"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(p.content) }}
              />
            </article>
          ))
        )}
      </main>
    </div>
  )
}
