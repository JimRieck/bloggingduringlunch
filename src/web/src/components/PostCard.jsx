import { Avatar } from './Avatar.jsx'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// The post-card look used everywhere a list of posts is browsed (the
// main page's recent-posts grid, and search results) -- factored out
// once it was needed identically in both places.
export function PostCard({ post, href, newTab = false, note }) {
  return (
    <article className="post-summary">
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
        <a href={href} {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {post.title}
        </a>
      </h2>
      <div className="recent-post-meta">
        <span>{post.organization.name}</span>
        <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
      </div>
      {note && <div className="post-card-note">{note}</div>}
    </article>
  )
}
