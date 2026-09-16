import { supabase } from './supabaseClient.js'

// Two-step fetch, not an embed -- organizations()/profiles() embeds are
// subject to those raw tables' own RLS (member-only / owner-only), so a
// post whose author or org the viewer can't otherwise see comes back
// with organization/author: null and used to crash the render. The
// *_public views have no such restriction and are safe to read
// anonymously. Shared by RecentPosts.jsx and SearchBox.jsx, which both
// need the same author/org info attached to a raw posts row.
export async function attachPostMeta(rows) {
  const orgIds = [...new Set(rows.map((p) => p.organization_id))]
  const authorIds = [...new Set(rows.map((p) => p.author_id))]
  const [{ data: orgRows }, { data: authorRows }] = await Promise.all([
    orgIds.length
      ? supabase.from('organizations_public').select('id, name, slug').in('id', orgIds)
      : Promise.resolve({ data: [] }),
    authorIds.length
      ? supabase.from('public_profiles').select('id, display_name, avatar_url').in('id', authorIds)
      : Promise.resolve({ data: [] }),
  ])
  const orgById = new Map((orgRows ?? []).map((o) => [o.id, o]))
  const authorById = new Map((authorRows ?? []).map((a) => [a.id, a]))
  return rows
    .map((p) => ({ ...p, organization: orgById.get(p.organization_id), author: authorById.get(p.author_id) }))
    .filter((p) => p.organization)
}
