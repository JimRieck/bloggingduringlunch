// The site runs on Eastern time (America/New_York -- EST in winter, EDT
// in summer). Every date range, "today", and displayed date or time goes
// through here, so they all agree with the database's day boundaries
// (public.site_day_start in 20261019100000_eastern_time_day_boundaries
// .sql) no matter what time zone the viewer's device is set to.
export const SITE_TIME_ZONE = 'America/New_York'

// YYYY-MM-DD of the Eastern calendar day `date` falls on. (en-CA happens
// to format dates as YYYY-MM-DD.)
export function siteDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SITE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

// The Eastern date `daysBack` days before today -- calendar arithmetic on
// the date itself, so a daylight-saving change in between can't shift it.
export function siteDateDaysAgo(daysBack, now = new Date()) {
  const day = new Date(`${siteDateString(now)}T12:00:00Z`)
  day.setUTCDate(day.getUTCDate() - daysBack)
  return day.toISOString().slice(0, 10)
}

// A label for a YYYY-MM-DD calendar date (a chart axis, a range end) --
// it names that date as-is, in any zone.
export function formatDayLabel(dateString, options = { month: 'short', day: 'numeric' }) {
  return new Date(`${dateString}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' })
}

// The Eastern date of a stored timestamp, e.g. "October 19, 2026".
export function formatSiteDate(iso, options = {}) {
  return new Date(iso).toLocaleDateString(undefined, { ...options, timeZone: SITE_TIME_ZONE })
}

// The long form used for post and comment dates: "October 19, 2026".
export function formatSiteLongDate(iso) {
  return formatSiteDate(iso, { year: 'numeric', month: 'long', day: 'numeric' })
}

// The Eastern date and time of a stored timestamp, with the zone shown,
// e.g. "Oct 19, 2026, 9:05 PM EDT".
export function formatSiteDateTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: SITE_TIME_ZONE,
    timeZoneName: 'short',
  })
}

// Just the time of day, e.g. "10:42 AM" -- for things that happened in
// the last few minutes, like the editor's "Saved 10:42 AM".
export function formatSiteTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: SITE_TIME_ZONE,
  })
}
