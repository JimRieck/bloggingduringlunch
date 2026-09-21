import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import {
  POST_STATUS_LABELS,
  RECURRENCE_LABELS,
  describeScheduleError,
  linkedinPostUrl,
} from '../lib/socialPosting.js'
import './ScheduledPostList.css'

function formatWhen(iso, timezone) {
  // Explicit fields rather than dateStyle/timeStyle -- those can't be
  // combined with timeZoneName, which is what says *which* zone this is.
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
    timeZoneName: 'short',
  })
}

export function ScheduledPostList({ schedules, posts, runs, onChanged }) {
  const [pendingId, setPendingId] = useState(null)
  const [error, setError] = useState('')

  const titleById = new Map(posts.map((p) => [p.id, p.title]))
  // Runs arrive newest-first, so the first success seen per schedule is
  // its most recent LinkedIn post.
  const lastPostUrn = new Map()
  for (const run of runs) {
    if (run.status === 'success' && run.external_id && !lastPostUrn.has(run.schedule_id)) {
      lastPostUrn.set(run.schedule_id, run.external_id)
    }
  }

  async function handlePauseResume(schedule) {
    setError('')
    setPendingId(schedule.id)
    const { error: rpcError } = await supabase.rpc('set_social_post_paused', {
      p_id: schedule.id,
      p_paused: schedule.status === 'scheduled',
    })
    setPendingId(null)
    if (rpcError) {
      setError('Couldn’t update that post. Try again.')
      return
    }
    onChanged()
  }

  async function handleDelete(schedule) {
    if (!window.confirm('Delete this scheduled post? Anything already posted to LinkedIn stays there.')) return
    setError('')
    setPendingId(schedule.id)
    const { error: deleteError } = await supabase.from('scheduled_social_posts').delete().eq('id', schedule.id)
    setPendingId(null)
    if (deleteError) {
      setError('Couldn’t delete that post. Try again.')
      return
    }
    onChanged()
  }

  return (
    <section className="social-card">
      <h3>Scheduled posts</h3>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {schedules.length === 0 ? (
        <p className="scheduled-empty">Nothing scheduled yet.</p>
      ) : (
        <ul className="scheduled-list">
          {schedules.map((s) => {
            const urn = lastPostUrn.get(s.id)
            const variations = s.messages.length - 1
            return (
              <li key={s.id} className="scheduled-row">
                <div className="scheduled-main">
                  <p className="scheduled-message">{s.messages[0]}</p>
                  <div className="scheduled-meta">
                    <span className={`status-badge status-${s.status}`}>{POST_STATUS_LABELS[s.status]}</span>
                    <span>{RECURRENCE_LABELS[s.recurrence]}</span>
                    {variations > 0 && (
                      <span>
                        +{variations} variation{variations === 1 ? '' : 's'}
                      </span>
                    )}
                    {s.post_id && <span>Links to: {titleById.get(s.post_id) ?? 'a blog post'}</span>}
                  </div>
                  <div className="scheduled-meta">
                    {s.status === 'scheduled' && s.next_run_at && <span>Next: {formatWhen(s.next_run_at, s.timezone)}</span>}
                    {s.run_count > 0 && (
                      <span>
                        Posted {s.run_count} time{s.run_count === 1 ? '' : 's'}
                      </span>
                    )}
                    {urn && (
                      <a href={linkedinPostUrl(urn)} target="_blank" rel="noopener noreferrer">
                        View last post
                      </a>
                    )}
                  </div>
                  {s.last_error && <p className="scheduled-error">{describeScheduleError(s.last_error)}</p>}
                </div>
                <div className="scheduled-actions">
                  {(s.status === 'scheduled' || s.status === 'paused' || s.status === 'failed') && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => handlePauseResume(s)}
                      disabled={pendingId === s.id}
                    >
                      {s.status === 'scheduled' ? 'Pause' : s.status === 'failed' ? 'Retry' : 'Resume'}
                    </button>
                  )}
                  <button type="button" className="link" onClick={() => handleDelete(s)} disabled={pendingId === s.id}>
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
