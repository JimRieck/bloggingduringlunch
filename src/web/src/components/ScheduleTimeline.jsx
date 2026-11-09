import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import {
  RECURRENCE_LABELS,
  describeScheduleError,
  formatScheduleTime,
  linkedinPostUrl,
} from '../lib/socialPosting.js'
import { RandomSlotList } from './RandomSlotList.jsx'

const UPCOMING_COUNT = 5

// Why a schedule has nothing coming up.
function nothingUpcoming(schedule) {
  if (schedule.status === 'paused') return 'Paused — nothing will post until you resume it.'
  if (schedule.status === 'completed') return 'Finished — nothing more to post.'
  if (schedule.status === 'failed') return 'Stopped after a failure — use Retry to start it again.'
  return 'Nothing more to post — it’s past its end date.'
}

// The upcoming posts of a random schedule: every slot still to run, from
// the next one on. Only while it's running -- paused or finished, nothing
// is coming up (and nothingUpcoming says why).
function loadRandomSlots(schedule) {
  if (schedule.status !== 'scheduled' || !schedule.next_run_at) return Promise.resolve({ data: [], error: null })
  return supabase
    .from('scheduled_social_post_slots')
    .select('run_at, post_id')
    .eq('schedule_id', schedule.id)
    .is('attempted_at', null)
    .gte('run_at', schedule.next_run_at)
    .order('run_at')
}

// One schedule's "Coming up" (the next few times it will post, worked
// out by the database with the scheduler's own rules --
// upcoming_social_runs; for a random schedule, every remaining post and
// which blog post it shares) and "History" (every run so far, from
// social_post_runs). Loads when opened; reloads when the schedule
// changes (after a pause, a retry, or a run).
export function ScheduleTimeline({ schedule, titleById = new Map() }) {
  const random = schedule.recurrence === 'random'
  const [upcoming, setUpcoming] = useState(null)
  const [history, setHistory] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [upcomingResult, historyResult] = await Promise.all([
        random
          ? loadRandomSlots(schedule)
          : supabase.rpc('upcoming_social_runs', { p_schedule_id: schedule.id, p_count: UPCOMING_COUNT }),
        supabase
          .from('social_post_runs')
          .select('id, ran_at, status, external_id, error, message')
          .eq('schedule_id', schedule.id)
          .order('ran_at', { ascending: false })
          .limit(50),
      ])
      if (cancelled) return
      setError(upcomingResult.error || historyResult.error ? 'Couldn’t load this post’s schedule. Try again.' : '')
      setUpcoming(upcomingResult.data ?? [])
      setHistory(historyResult.data ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
    // Reloads only when the schedule actually changes, not on every refresh
    // of the list (which hands down new objects for the same schedules).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.id, schedule.status, schedule.next_run_at, schedule.run_count, random])

  if (upcoming === null || history === null) {
    return <p className="schedule-timeline-status">Loading…</p>
  }

  const variations = schedule.messages.length
  const repeating = schedule.recurrence !== 'none' && !random
  // Only the first few times are listed; say how it carries on.
  const continues =
    repeating && upcoming.length === UPCOMING_COUNT
      ? schedule.ends_at
        ? `…then ${RECURRENCE_LABELS[schedule.recurrence].toLowerCase()} until ${formatScheduleTime(schedule.ends_at, schedule.timezone)}.`
        : `…then ${RECURRENCE_LABELS[schedule.recurrence].toLowerCase()}, with no end date.`
      : null

  return (
    <div className="schedule-timeline">
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <div className="schedule-timeline-section">
        <h4>{random && upcoming.length > 0 ? `Coming up (${upcoming.length})` : 'Coming up'}</h4>
        {upcoming.length === 0 ? (
          <p className="schedule-timeline-status">{nothingUpcoming(schedule)}</p>
        ) : random ? (
          <RandomSlotList
            slots={upcoming.map((u) => ({
              runAt: u.run_at,
              title: titleById.get(u.post_id) ?? 'Another of your posts, picked when it goes out',
            }))}
            timeZone={schedule.timezone}
            label="Upcoming random posts"
          />
        ) : (
          <ol className="schedule-timeline-list">
            {upcoming.map((u) => (
              <li key={u.run_at}>
                <time dateTime={u.run_at}>{formatScheduleTime(u.run_at, schedule.timezone)}</time>
                {variations > 1 && <span className="schedule-timeline-detail">Variation {u.variation}</span>}
              </li>
            ))}
          </ol>
        )}
        {continues && <p className="schedule-timeline-status">{continues}</p>}
      </div>

      <div className="schedule-timeline-section">
        <h4>History</h4>
        {history.length === 0 ? (
          <p className="schedule-timeline-status">Hasn&rsquo;t posted yet.</p>
        ) : (
          <ol className="schedule-timeline-list">
            {history.map((run) => (
              <li key={run.id}>
                <time dateTime={run.ran_at}>{formatScheduleTime(run.ran_at, schedule.timezone)}</time>
                <span className={`run-result run-${run.status}`}>{run.status === 'success' ? 'Posted' : 'Failed'}</span>
                {run.status === 'success' && run.external_id && (
                  <a href={linkedinPostUrl(run.external_id)} target="_blank" rel="noopener noreferrer">
                    View on LinkedIn
                  </a>
                )}
                {run.status === 'failed' && run.error && (
                  <span className="schedule-timeline-error">{describeScheduleError(run.error)}</span>
                )}
                {run.message && <span className="schedule-timeline-message">{run.message}</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
