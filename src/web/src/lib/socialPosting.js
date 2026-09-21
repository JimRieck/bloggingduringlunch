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

// Reason codes come back from supabase/functions/linkedin-oauth-callback
// as ?reason=... when connecting LinkedIn fails.
export function describeConnectError(reason) {
  if (!reason) return 'Couldn’t connect LinkedIn. Try again.'
  if (reason === 'unauthorized_scope_error' || reason === 'invalid_scope_error') {
    return 'LinkedIn refused the permissions requested. In your LinkedIn app, open the Products tab and make sure both “Share on LinkedIn” and “Sign In with LinkedIn using OpenID Connect” are added and approved, then try again.'
  }
  if (reason === 'user_cancelled_authorize' || reason === 'user_cancelled_login' || reason === 'access_denied') {
    return 'The LinkedIn connection was cancelled. Try again when you’re ready.'
  }
  if (reason === 'state_invalid') return 'That connection attempt expired or was already used. Try again.'
  if (reason === 'not_configured') return 'LinkedIn app credentials haven’t been added to this site yet.'
  if (reason === 'feature_disabled') return 'LinkedIn posting is turned off.'
  if (reason.startsWith('token_exchange_')) {
    return `LinkedIn wouldn’t exchange the approval for access (${reason.replace('token_exchange_', 'HTTP ')}). Check that the Client ID and Client Secret saved on this site are the ones from the same LinkedIn app, and that the redirect URL there matches exactly.`
  }
  if (reason.startsWith('userinfo_')) {
    return 'Connected, but LinkedIn wouldn’t share your profile. Make sure “Sign In with LinkedIn using OpenID Connect” is added and approved on your LinkedIn app.'
  }
  return `Couldn’t connect LinkedIn (${reason}). Try again.`
}

export function linkedinPostUrl(urn) {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`
}

// <input type="datetime-local"> wants local wall-clock time, not UTC.
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
