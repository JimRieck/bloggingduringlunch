import { useState } from 'react'
import { loadPostPreview } from '../lib/postPreview.js'
import { PostArticle } from './PostArticle.jsx'
import './TenantBlog.css'
import './PostPreview.css'

// The tab PostForm.jsx's Preview button opens: the post exactly as the
// published blog renders it (same PostArticle, same styles), read from
// what the editor stashed in localStorage rather than from the
// database, so unsaved changes show up too.
export function PostPreview({ previewId }) {
  const [draft] = useState(() => (previewId ? loadPostPreview(previewId) : null))

  if (!draft) {
    return (
      <div id="tenant-blog" className="tenant-status">
        <h1>Preview not available</h1>
        <p>Go back to the post editor and click Preview again.</p>
      </div>
    )
  }

  return (
    <div id="tenant-blog">
      <p className="preview-banner" role="status">
        <strong>Preview</strong> &mdash; only you can see this. Nothing is saved or published until you click Save
        draft or Publish in the editor.
      </p>
      <header id="tenant-header">
        <h1>{draft.organizationName}</h1>
      </header>
      <main id="tenant-posts">
        <PostArticle post={draft.post} />
      </main>
    </div>
  )
}
