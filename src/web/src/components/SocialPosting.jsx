import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useFeatureFlags } from '../lib/featureFlags.js'
import { describeConnectError } from '../lib/socialPosting.js'
import { LinkedInConnection } from './LinkedInConnection.jsx'
import { SchedulePostForm } from './SchedulePostForm.jsx'
import { ScheduledPostList } from './ScheduledPostList.jsx'
import './SocialPosting.css'

export function SocialPosting({ session }) {
  const featureFlags = useFeatureFlags()
  const [connection, setConnection] = useState(undefined)
  const [schedules, setSchedules] = useState([])
  const [runs, setRuns] = useState([])
  const [posts, setPosts] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  // LinkedIn sends the browser back here with ?linkedin=connected|error.
  const [returned] = useState(() => new URLSearchParams(window.location.search).get('linkedin'))
  const [returnedReason] = useState(() => new URLSearchParams(window.location.search).get('reason'))

  useEffect(() => {
    if (returned) window.history.replaceState({}, '', window.location.pathname)
  }, [returned])

  useEffect(() => {
    if (!featureFlags.linkedin_posting) return
    let cancelled = false
    async function load() {
      const [{ data: conn }, { data: scheduleRows }, { data: runRows }, { data: postRows }] = await Promise.all([
        supabase.rpc('my_linkedin_connection'),
        supabase
          .from('scheduled_social_posts')
          .select('id, post_id, messages, next_run_at, timezone, recurrence, ends_at, status, run_count, last_error')
          .order('created_at', { ascending: false }),
        supabase
          .from('social_post_runs')
          .select('schedule_id, status, external_id')
          .order('ran_at', { ascending: false })
          .limit(200),
        supabase
          .from('posts')
          .select('id, title')
          .eq('author_id', session.user.id)
          .eq('status', 'published')
          .order('published_at', { ascending: false }),
      ])
      if (cancelled) return
      setConnection(conn?.[0] ?? null)
      setSchedules(scheduleRows ?? [])
      setRuns(runRows ?? [])
      setPosts(postRows ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [featureFlags.linkedin_posting, session.user.id, reloadKey])

  const refresh = () => setReloadKey((k) => k + 1)

  if (!featureFlags.linkedin_posting) {
    return (
      <div id="social-posting">
        <h2>Social posting</h2>
        <p className="social-status">Social posting isn&rsquo;t available right now.</p>
      </div>
    )
  }

  const connected = !!connection && new Date(connection.expires_at) > new Date()

  return (
    <div id="social-posting">
      <h2>Social posting</h2>
      <p className="social-intro">
        Schedule posts to LinkedIn &mdash; once, or on a repeat &mdash; optionally linking one of your blog posts.
      </p>

      {returned === 'connected' && (
        <p className="auth-notice" role="status">
          LinkedIn connected.
        </p>
      )}
      {returned === 'error' && (
        <p className="field-error" role="alert">
          {describeConnectError(returnedReason)}
        </p>
      )}

      {connection === undefined ? (
        <p className="social-status">Loading…</p>
      ) : (
        <>
          <LinkedInConnection connection={connection} onChanged={refresh} />
          <SchedulePostForm posts={posts} connected={connected} onCreated={refresh} />
          <ScheduledPostList schedules={schedules} posts={posts} runs={runs} onChanged={refresh} />
        </>
      )}
    </div>
  )
}
