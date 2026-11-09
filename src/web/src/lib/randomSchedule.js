// Plans a "Random" social posting schedule: N posts a day, from a start
// date to an end date, each at a random time inside the author's daily
// window and each a randomly chosen blog post. Runs in the browser so the
// author can review the whole plan (and shuffle it again) before saving;
// create_random_social_schedule (20261109100100_random_social_schedules.sql)
// then checks it and saves it exactly as reviewed.
//
// Times are local to the author's device -- the same time zone the
// schedule is saved with, and that ScheduleTimeline shows it in.

export const MAX_POSTS_PER_DAY = 5
export const MAX_RANDOM_DAYS = 90
export const DEFAULT_WINDOW_START = '09:00'
export const DEFAULT_WINDOW_END = '17:00'
// A slot this close to now is left out: it would be past before the
// author finished reviewing.
const MIN_LEAD_MINUTES = 5
// Each post gets its own stretch of the window at least this long.
const MIN_MINUTES_PER_POST = 15

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function localDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Whole days from `a` to `b` (local dates), ignoring daylight saving.
function daysBetween(a, b) {
  return Math.round((localDate(b) - localDate(a)) / 86_400_000)
}

function todayString(now) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Fisher-Yates, with the random source passed in so tests can fix it.
export function shuffle(items, random = Math.random) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// What's wrong with these settings, in words for the form -- or null.
export function randomPlanProblem({ posts, perDay, startDate, endDate, windowStart, windowEnd, now = new Date() }) {
  if (posts.length < 2) {
    return 'Random posting needs at least two published blog posts to choose from.'
  }
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > MAX_POSTS_PER_DAY) {
    return `Choose between 1 and ${MAX_POSTS_PER_DAY} posts a day.`
  }
  if (!startDate || !endDate) return 'Choose a start and an end date.'
  if (endDate < startDate) return 'The end date has to be on or after the start date.'
  if (endDate < todayString(now)) return 'The end date has already passed.'
  if (daysBetween(startDate, endDate) + 1 > MAX_RANDOM_DAYS) {
    return `A random schedule can cover at most ${MAX_RANDOM_DAYS} days.`
  }
  if (!windowStart || !windowEnd || minutesOf(windowEnd) <= minutesOf(windowStart)) {
    return 'The “until” time has to be later than the “from” time.'
  }
  if (minutesOf(windowEnd) - minutesOf(windowStart) < perDay * MIN_MINUTES_PER_POST) {
    return `Widen the time window — ${perDay} posts a day need at least ${perDay * MIN_MINUTES_PER_POST} minutes.`
  }
  return null
}

// Hands out posts from a shuffled "bag": every post goes out once before
// any goes out again, the same post never goes out twice in a row, and --
// when there are at least as many posts as posts a day -- never twice on
// the same day. A fresh shuffle each time the bag runs out.
function postPicker(posts, random) {
  let bag = []
  let last = null
  return function pick(usedToday) {
    if (bag.length === 0) bag = shuffle(posts, random)
    let index = bag.findIndex((p) => p.id !== last?.id && !usedToday.has(p.id))
    if (index === -1) index = bag.findIndex((p) => p.id !== last?.id)
    if (index === -1) index = 0
    const [post] = bag.splice(index, 1)
    last = post
    return post
  }
}

// [{ runAt: Date, post }], in time order. Each day's window is split into
// perDay equal stretches with one post at a random minute in each, so the
// posts are spread through the day and never bunch together. Times
// already past (or within a few minutes) are left out.
export function planRandomSchedule({
  posts,
  perDay,
  startDate,
  endDate,
  windowStart,
  windowEnd,
  now = new Date(),
  random = Math.random,
}) {
  const from = minutesOf(windowStart)
  const stretch = (minutesOf(windowEnd) - from) / perDay
  const earliest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000)
  const pick = postPicker(posts, random)
  const slots = []

  const days = daysBetween(startDate, endDate)
  for (let d = 0; d <= days; d += 1) {
    const day = localDate(startDate)
    day.setDate(day.getDate() + d)
    const usedToday = new Set()
    for (let i = 0; i < perDay; i += 1) {
      const minute = Math.floor(from + i * stretch + random() * stretch)
      const runAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute)
      if (runAt < earliest) continue
      const post = pick(usedToday)
      usedToday.add(post.id)
      slots.push({ runAt, post })
    }
  }
  return slots
}

// For showing a plan: slots grouped by day in `timeZone`, each day with a
// heading like "Mon, Nov 10" and each slot with a time like "10:42 AM".
export function groupSlotsByDay(slots, timeZone) {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dayLabel = new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' })
  const days = []
  for (const slot of slots) {
    const at = new Date(slot.runAt)
    const key = dayKey.format(at)
    if (days.at(-1)?.key !== key) days.push({ key, label: dayLabel.format(at), slots: [] })
    days.at(-1).slots.push({ ...slot, time: timeLabel.format(at) })
  }
  return days
}
