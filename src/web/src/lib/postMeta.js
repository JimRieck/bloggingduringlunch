import { supabase } from './supabaseClient.js'

// Module-level (not component state) so this survives across every
// RecentPosts/SearchBox mount for the life of the page -- organizations
// and author profiles change rarely, and were otherwise being re-fetched
// on every single keystroke-driven search, which was a big chunk of the
// felt search lag. Keyed by row id; only ever grows for the session, no
// TTL -- a full page reload is what clears it, same as any other
// in-memory cache this small.
const orgCache = new Map()
const authorCache = new Map()

async function fillCache(ids, cache, table, columns) {
  const missing = ids.filter((id) => !cache.has(id))
  if (missing.length === 0) return
  const { data } = await supabase.from(table).select(columns).in('id', missing)
  for (const row of data ?? []) cache.set(row.id, row)
}

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
  await Promise.all([
    fillCache(orgIds, orgCache, 'organizations_public', 'id, name, slug'),
    fillCache(authorIds, authorCache, 'public_profiles', 'id, display_name, avatar_url'),
  ])
  return rows
    .map((p) => ({ ...p, organization: orgCache.get(p.organization_id), author: authorCache.get(p.author_id) }))
    .filter((p) => p.organization)
}
