import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { linkedinPostTemplate } from '../lib/socialPosting.js'
import {
  DEFAULT_WINDOW_END,
  DEFAULT_WINDOW_START,
  MAX_POSTS_PER_DAY,
  planRandomSchedule,
  randomPlanProblem,
} from '../lib/randomSchedule.js'
import { RandomSlotList } from './RandomSlotList.jsx'
import './RandomSchedulePlanner.css'

function dateInputValue(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function inDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// "09:00" -> "9:00 AM", in the author's own locale.
function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// What the database says, for a person. create_random_social_schedule's
// checks mirror randomPlanProblem, so most of these only show up if the
// page and the database disagree (e.g. a post unpublished meanwhile).
function describeSaveError(message = '') {
  if (message.includes('too many active')) {
    return 'You have the maximum of 20 active scheduled posts. Delete or wait for one to finish.'
  }
  if (message.includes('published posts')) {
    return 'One of the posts in this plan isn’t published any more. Shuffle again to make a new plan.'
  }
  if (message.includes('already passed')) return 'Every time in this plan has already passed. Shuffle again.'
  return 'Couldn’t save that schedule. Try again.'
}

// "Random" in the social posting form: N posts a day between two times,
// from a start date to an end date, each a randomly chosen published blog
// post (lib/randomSchedule.js). The author sees the whole plan -- every
// day, time and post -- and can shuffle it again before confirming; what
// they confirm is exactly what's saved and posted.
export function RandomSchedulePlanner({ posts, connected, onCreated }) {
  const [perDay, setPerDay] = useState(2)
  const [startDate, setStartDate] = useState(() => dateInputValue(new Date()))
  const [endDate, setEndDate] = useState(() => dateInputValue(inDays(6)))
  const [windowStart, setWindowStart] = useState(DEFAULT_WINDOW_START)
  const [windowEnd, setWindowEnd] = useState(DEFAULT_WINDOW_END)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  // Only posts with a public address can be shared.
  const shareable = posts.filter((p) => p.url)
  const settings = { posts: shareable, perDay, startDate, endDate, windowStart, windowEnd }

  // Changing any setting throws the old plan away, so what's confirmed
  // always matches what's on screen.
  function change(setter, parse = (value) => value) {
    return (e) => {
      setter(parse(e.target.value))
      setPlan(null)
      setNotice('')
    }
  }

  function makePlan() {
    const problem = randomPlanProblem(settings)
    if (problem) {
      setError(problem)
      setPlan(null)
      return
    }
    const slots = planRandomSchedule(settings)
    if (slots.length === 0) {
      setError('Every time in that range has already passed. Choose a later end date or time.')
      setPlan(null)
      return
    }
    setError('')
    setNotice('')
    setPlan(slots)
  }

  async function confirm() {
    setError('')
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('create_random_social_schedule', {
      p_timezone: timeZone,
      p_slots: plan.map((s) => ({
        run_at: s.runAt.toISOString(),
        post_id: s.post.id,
        message: linkedinPostTemplate(s.post.title, s.post.url, s.post.description),
      })),
    })
    setBusy(false)
    if (rpcError) {
      setError(describeSaveError(rpcError.message))
      return
    }
    setNotice(`Scheduled ${plan.length} random post${plan.length === 1 ? '' : 's'}.`)
    setPlan(null)
    onCreated()
  }

  const days = plan ? new Set(plan.map((s) => s.runAt.toDateString())).size : 0

  return (
    <div className="random-planner">
      <p className="schedule-hint">
        Each time, one of your published blog posts is picked at random and shared with its title, description and
        link. Every post goes out once before any repeats, never twice in a row, and never twice on the same day when
        you have enough posts.
      </p>

      <div className="random-planner-settings">
        <label className="field">
          <span>Posts a day</span>
          <select value={perDay} onChange={change(setPerDay, Number)} disabled={busy}>
            {Array.from({ length: MAX_POSTS_PER_DAY }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Start date</span>
          <input type="date" value={startDate} onChange={change(setStartDate)} disabled={busy} />
        </label>
        <label className="field">
          <span>End date</span>
          <input type="date" value={endDate} onChange={change(setEndDate)} disabled={busy} />
        </label>
        {/* The two ends of the posting hours stay side by side. */}
        <div className="random-planner-hours">
          <label className="field">
            <span>Between</span>
            <input type="time" value={windowStart} onChange={change(setWindowStart)} disabled={busy} />
          </label>
          <label className="field">
            <span>and</span>
            <input type="time" value={windowEnd} onChange={change(setWindowEnd)} disabled={busy} />
          </label>
        </div>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}

      {plan ? (
        <div className="random-planner-review">
          <h4>Review your schedule</h4>
          <p className="schedule-hint">
            {plan.length} post{plan.length === 1 ? '' : 's'} over {days} day{days === 1 ? '' : 's'}, {perDay} a day
            between {timeLabel(windowStart)} and {timeLabel(windowEnd)} ({timeZone}). Nothing is scheduled until you
            confirm.
          </p>
          <RandomSlotList
            slots={plan.map((s) => ({ runAt: s.runAt, title: s.post.title }))}
            timeZone={timeZone}
            label="Planned random posts"
          />
          <div className="schedule-actions">
            <button type="button" className="secondary" onClick={makePlan} disabled={busy}>
              Shuffle again
            </button>
            <button type="button" className="primary" onClick={confirm} disabled={busy || !connected}>
              {busy ? 'Scheduling…' : `Confirm ${plan.length} post${plan.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="schedule-actions">
          <button type="button" className="primary" onClick={makePlan} disabled={busy}>
            Create schedule
          </button>
        </div>
      )}
      {!connected && <p className="schedule-hint">Connect LinkedIn above to schedule posts.</p>}
    </div>
  )
}
