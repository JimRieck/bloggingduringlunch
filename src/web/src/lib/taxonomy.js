import { supabase } from './supabaseClient.js'

// Shared by the AI auto-suggest flow (PostForm.jsx, BulkAutoTag.jsx) and
// the WordPress importer -- all three need the same operation: given a
// list of plain names, return category/tag ids, creating whatever
// doesn't already exist. `existingCategories`/`existingTags` are
// mutated in place (a newly-created row is appended) so a caller
// resolving several batches in a loop -- one call per post, say --
// doesn't recreate the same not-yet-in-state category/tag twice.
//
// Deliberately lenient: skips a name that fails to create instead of
// aborting the whole batch. That's the right trade-off for a
// best-effort AI suggestion or a many-post import, not for the
// explicit Save action in PostForm.jsx, which keeps its own stricter
// abort-on-error tag-creation logic unchanged.

export async function resolveCategoryIds(names, organizationId, existingCategories) {
  const ids = []
  for (const rawName of names) {
    const name = rawName.trim()
    if (!name) continue
    const existing = existingCategories.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      ids.push(existing.id)
      continue
    }
    const { data } = await supabase
      .from('categories')
      .insert({ organization_id: organizationId, name })
      .select('id, name')
      .single()
    if (!data) continue
    existingCategories.push(data)
    ids.push(data.id)
  }
  return ids
}

export async function resolveTagIds(names, authorId, existingTags) {
  const ids = []
  for (const rawName of names) {
    const name = rawName.trim()
    if (!name) continue
    const existing = existingTags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      ids.push(existing.id)
      continue
    }
    const { data } = await supabase.from('tags').insert({ author_id: authorId, name }).select('id, name').single()
    if (!data) continue
    existingTags.push(data)
    ids.push(data.id)
  }
  return ids
}
