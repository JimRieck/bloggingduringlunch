// Mirrors public.suggestion_status (20260918110000_create_suggestions.sql)
// and the STATUS_LABELS map in supabase/functions/update-suggestion-status
// -- Deno functions can't import across the supabase/ <-> src/web/
// boundary, so this list is duplicated there, same as invite-member's
// EMAIL_PATTERN already is.
export const SUGGESTION_STATUSES = ['new', 'under_review', 'planned', 'completed', 'declined']

export const SUGGESTION_STATUS_LABELS = {
  new: 'New',
  under_review: 'Under review',
  planned: 'Planned',
  completed: 'Completed',
  declined: 'Declined',
}
