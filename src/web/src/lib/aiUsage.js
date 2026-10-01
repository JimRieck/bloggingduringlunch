// Display labels for ai_usage_events.feature -- the keys each AI Edge
// Function passes to recordAiUsage (supabase/functions/_shared/
// aiUsage.ts). An unknown key falls back to the raw value, so a newly
// added feature still shows up on /admin before it gets a label here.
export const AI_FEATURE_LABELS = {
  titles: 'Suggest titles',
  tags_and_categories: 'Auto-suggest tags & categories',
  bulk_auto_tag: 'Bulk auto-tag (one call per post)',
  post_draft: 'Generate post draft',
  image: 'Generate image',
}

export function aiFeatureLabel(feature) {
  return AI_FEATURE_LABELS[feature] ?? feature
}

// A UTC calendar date `daysBack` days before today, as YYYY-MM-DD --
// the same UTC-date convention the ai_usage_by_* RPCs filter on.
export function isoDateDaysAgo(daysBack, now = new Date()) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - daysBack)
  return date.toISOString().slice(0, 10)
}
