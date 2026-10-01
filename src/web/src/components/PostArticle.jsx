import { useEffect, useRef } from 'react'
import DOMPurify from 'dompurify'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// One post as readers see it: thumbnail, title, date, category/tag
// badges and the sanitized body. Shared by the published blog
// (TenantBlog.jsx) and the editor's preview tab (PostPreview.jsx) so a
// preview can't drift from the real thing. Styled by TenantBlog.css,
// inside a #tenant-posts container.
//
// `post` is { title, content, published_at, thumbnail_url, categories,
// tags } (categories/tags as name strings). `titleHref` turns the title
// into a link; `children` render after the body (ratings, comments).
export function PostArticle({ post, titleHref, id, children }) {
  const bodyRef = useRef(null)

  // The body is inserted via dangerouslySetInnerHTML, so a YoutubeEmbed
  // node only ever survives sanitization as the inert placeholder div
  // YoutubeEmbedExtension.js renders it as (see that file's comment) --
  // this hydrates each one into a real <iframe> via plain DOM APIs
  // after React commits, never by trusting HTML the sanitizer approved.
  // The video id is re-validated here too, even though only our own
  // editor ever produces this markup.
  useEffect(() => {
    const container = bodyRef.current
    if (!container) return
    for (const placeholder of container.querySelectorAll('[data-type="youtube-embed"]')) {
      if (placeholder.querySelector('iframe')) continue
      const videoId = placeholder.getAttribute('data-video-id')
      if (!videoId || !/^[\w-]{6,20}$/.test(videoId)) continue
      const iframe = document.createElement('iframe')
      iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}`
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      iframe.allowFullscreen = true
      iframe.frameBorder = '0'
      placeholder.classList.add('youtube-embed-wrapper')
      placeholder.appendChild(iframe)
    }
  }, [post.content])

  return (
    <article className="post-summary" id={id}>
      {post.thumbnail_url && <img src={post.thumbnail_url} alt="" className="post-thumbnail" />}
      <h2>{titleHref ? <a href={titleHref}>{post.title}</a> : post.title}</h2>
      <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
      {(post.categories.length > 0 || post.tags.length > 0) && (
        <div className="post-taxonomy">
          {post.categories.map((c) => (
            <span className="post-category-badge" key={c}>
              {c}
            </span>
          ))}
          {post.tags.map((t) => (
            <span className="post-tag-badge" key={t}>
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="post-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content) }} />
      {children}
    </article>
  )
}
