// Mirrors public.social_recurrence / social_post_status
// (20260921100000_linkedin_scheduled_posts.sql).
export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
]

export const RECURRENCE_LABELS = {
  none: 'One time',
  daily: 'Repeats daily',
  weekly: 'Repeats weekly',
  monthly: 'Repeats monthly',
}

export const POST_STATUS_LABELS = {
  scheduled: 'Scheduled',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
}

// Limits enforced server-side too (prepare_scheduled_social_post); the UI
// caps variations lower than the database's 10 to keep the form usable.
export const MAX_MESSAGE_LENGTH = 3000
export const MAX_VARIATIONS = 5

// Errors recorded by supabase/functions/_shared/linkedin.ts, rewritten
// for a person rather than a log.
export function describeScheduleError(error) {
  if (!error) return ''
  if (error === 'not_connected') return 'LinkedIn isn’t connected. Reconnect, then resume this post.'
  if (error === 'token_expired') return 'Your LinkedIn connection expired. Reconnect, then resume this post.'
  if (error === 'post_not_published') return 'The blog post this links to isn’t published.'
  if (error.startsWith('linkedin_401') || error.startsWith('linkedin_403')) {
    return 'LinkedIn rejected the connection. Reconnect, then resume this post.'
  }
  return error
}

export function linkedinPostUrl(urn) {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`
}

// <input type="datetime-local"> wants local wall-clock time, not UTC.
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
