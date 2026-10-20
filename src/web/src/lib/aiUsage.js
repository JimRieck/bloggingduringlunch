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
  description: 'Write description',
}

export function aiFeatureLabel(feature) {
  return AI_FEATURE_LABELS[feature] ?? feature
}
