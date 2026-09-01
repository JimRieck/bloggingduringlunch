import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './TenantBlog.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function TenantBlog({ slug }) {
  const [status, setStatus] = useState('loading')
  const [organization, setOrganization] = useState(null)
  const [posts, setPosts] = useState([])

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

      const { data: orgPosts } = await supabase
        .from('posts')
        .select('title, slug, content, published_at')
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
  }, [slug])

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
        <h1>Blog not found</h1>
        <p>There&rsquo;s no blog at this address.</p>
      </div>
    )
  }

  return (
    <div id="tenant-blog">
      <header id="tenant-header">
        <h1>{organization.name}</h1>
      </header>
      <main id="tenant-posts">
        {posts.length === 0 ? (
          <p className="tenant-empty">No posts published yet.</p>
        ) : (
          posts.map((post) => (
            <article className="post-summary" key={post.slug}>
              <h2>{post.title}</h2>
              <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
              <p>{post.content}</p>
            </article>
          ))
        )}
      </main>
    </div>
  )
}
