import { isLinkedInUnsupportedImage } from '../lib/socialPosting.js'

// Roughly how LinkedIn will show the linked blog post under the text:
// the post's thumbnail with its title and the site's address beside it.
export function LinkedInCardPreview({ post }) {
  const unsupported = isLinkedInUnsupportedImage(post.thumbnailUrl)
  const showImage = post.thumbnailUrl && !unsupported
  let host = ''
  try {
    host = new URL(post.url).host
  } catch {
    // no usable address -- leave the domain line out
  }

  return (
    <figure className="linkedin-card-preview" aria-label="Link card preview">
      <figcaption className="linkedin-card-caption">LinkedIn will show this card with your post</figcaption>
      <div className="linkedin-card">
        {showImage ? (
          <img className="linkedin-card-image" src={post.thumbnailUrl} alt="" />
        ) : (
          <div className="linkedin-card-image linkedin-card-no-image" aria-hidden="true" />
        )}
        <div className="linkedin-card-text">
          <span className="linkedin-card-title">{post.title}</span>
          {host && <span className="linkedin-card-host">{host}</span>}
        </div>
      </div>
      {!post.thumbnailUrl && <p className="schedule-hint">This post has no thumbnail, so the card won&rsquo;t have a picture.</p>}
      {unsupported && (
        <p className="schedule-hint">
          This post&rsquo;s thumbnail is a WebP image, which LinkedIn doesn&rsquo;t accept, so the card won&rsquo;t
          have a picture.
        </p>
      )}
    </figure>
  )
}
