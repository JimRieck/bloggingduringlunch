import { useEffect, useState } from 'react'
import { Avatar } from './Avatar.jsx'
import { supabase } from '../lib/supabaseClient.js'
import './CommentSection.css'

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function CommentSection({ postId, session }) {
  const [comments, setComments] = useState(null)
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [posting, setPosting] = useState(false)
  // Bumped (a plain, synchronous state update -- no async work of its
  // own) to ask the effect below to refetch, instead of calling an
  // external async load() function directly from the event handlers.
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: rows } = await supabase
        .from('post_comments')
        .select('id, body, created_at, user_id')
        .eq('post_id', postId)
        .order('created_at', { ascending: true })

      const commentRows = rows ?? []
      const userIds = [...new Set(commentRows.map((c) => c.user_id))]
      // Two-step fetch, not an embedded profiles(...) select: `profiles`
      // RLS only allows a user to see their own row, so an embed would
      // come back null for every commenter but yourself.
      const { data: profileRows } = userIds.length
        ? await supabase.from('public_profiles').select('id, display_name, avatar_url').in('id', userIds)
        : { data: [] }
      const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]))

      if (cancelled) return
      setComments(commentRows.map((c) => ({ ...c, author: profileById.get(c.user_id) })))
    }

    load()
    return () => {
      cancelled = true
    }
  }, [postId, refreshKey])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!body.trim()) return
    setPosting(true)
    setError('')
    const { error: insertError } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id: session.user.id, body: body.trim() })
    setPosting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    setBody('')
    setRefreshKey((k) => k + 1)
  }

  async function handleDelete(commentId) {
    if (!window.confirm('Delete this comment?')) return
    await supabase.from('post_comments').delete().eq('id', commentId)
    setRefreshKey((k) => k + 1)
  }

  return (
    <section id="comments">
      <h3>Comments{comments ? ` (${comments.length})` : ''}</h3>

      {comments === null ? (
        <p className="comments-status">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="comments-status">No comments yet.</p>
      ) : (
        <ul className="comment-list">
          {comments.map((comment) => (
            <li className="comment" key={comment.id}>
              <Avatar url={comment.author?.avatar_url} label={comment.author?.display_name} />
              <div>
                <div className="comment-meta">
                  <span className="comment-author">{comment.author?.display_name ?? 'Someone'}</span>
                  <time dateTime={comment.created_at}>{formatDate(comment.created_at)}</time>
                </div>
                <p className="comment-body">{comment.body}</p>
                {session?.user?.id === comment.user_id && (
                  <button type="button" className="link" onClick={() => handleDelete(comment.id)}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {session ? (
        <form className="comment-form" onSubmit={handleSubmit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment…"
            rows={3}
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="primary" disabled={posting || !body.trim()}>
            {posting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      ) : (
        <p className="comments-status">
          <a className="link" href="/">
            Log in or register
          </a>{' '}
          to leave a comment.
        </p>
      )}
    </section>
  )
}
