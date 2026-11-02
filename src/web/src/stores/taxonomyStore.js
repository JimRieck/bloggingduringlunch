import { create } from 'zustand'

// The signed-in author's own tags (tags are private to their author) and
// each blog's categories (shared by everyone writing in that blog), for
// the three screens that read and create them: the post editor
// (PostForm.jsx), the WordPress importer and bulk auto-tag.
//
// Every action reads the lists with get() at the moment it needs them,
// so a long loop of awaits -- one import or auto-tag call per post --
// always sees what the previous iteration created. Before this store,
// each screen kept the lists in React state and had to thread a mutable
// copy through its loop instead, because state read inside the loop was
// the pre-loop snapshot; reading that stale snapshot once let bulk
// auto-tag re-create the same category for every post.
//
// Lists are kept sorted by name, the order the editor shows them in.

const byName = (a, b) => a.name.localeCompare(b.name)
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

// What a selector should fall back to for a blog whose categories aren't
// loaded: the same array every time. `s.categoriesByOrg[id] ?? []` would
// hand back a new array on every call, which Zustand 5 treats as a change
// and re-renders forever.
export const NO_CATEGORIES = Object.freeze([])

// An ILIKE pattern that matches `name` exactly, ignoring case only.
const exactly = (name) => name.replace(/[\\%_]/g, (c) => `\\${c}`)

export function createTaxonomyStore(client) {
  return create((set, get) => {
    // { row } for the row named `name` (ignoring case) in `table` within
    // `scope` ({ organization_id } or { author_id }), created if there
    // isn't one -- or { error }. Looks in the database first rather than
    // trusting the store's list, which can be missing a row another tab
    // or editor added: categories have no update policy, so the upsert
    // this replaced was refused by RLS for an existing name and the
    // category was silently left off the post; and tags are only unique
    // by slug, which the slug trigger suffixes on a clash, so a plain
    // insert made a second tag with the same name.
    async function findOrCreate(table, scope, name) {
      const find = () => client.from(table).select('id, name').match(scope).ilike('name', exactly(name)).limit(1)
      const { data: found, error: findError } = await find()
      if (findError) return { error: findError }
      if (found.length) return { row: found[0] }
      const { data, error } = await client.from(table).insert({ ...scope, name }).select('id, name').single()
      if (!error) return { row: data }
      // Created by someone else between the two queries -- categories'
      // (organization_id, name) unique constraint catches that.
      if (error.code === '23505') {
        const { data: raced } = await find()
        if (raced?.length) return { row: raced[0] }
      }
      return { error }
    }

    const addCategoryRow = (orgId, row) =>
      set((s) => ({
        categoriesByOrg: { ...s.categoriesByOrg, [orgId]: [...(s.categoriesByOrg[orgId] ?? []), row].sort(byName) },
      }))
    const addTagRow = (row) => set((s) => ({ tags: [...s.tags, row].sort(byName) }))

    return {
      // Whose tags `tags` holds; null until loadTags.
      tagsAuthorId: null,
      tags: [],
      // { [organizationId]: [{ id, name }] } for each blog loaded so far.
      categoriesByOrg: {},

      async loadTags(authorId) {
        const { data } = await client.from('tags').select('id, name').eq('author_id', authorId).order('name')
        set({ tagsAuthorId: authorId, tags: data ?? [] })
      },

      // One blog or several (bulk auto-tag covers every blog the author
      // has posts in), in one query.
      async loadCategories(orgIds) {
        const ids = [orgIds].flat().filter(Boolean)
        if (ids.length === 0) return
        const { data } = await client
          .from('categories')
          .select('id, name, organization_id')
          .in('organization_id', ids)
          .order('name')
        const loaded = Object.fromEntries(ids.map((id) => [id, []]))
        for (const c of data ?? []) loaded[c.organization_id].push({ id: c.id, name: c.name })
        set((s) => ({ categoriesByOrg: { ...s.categoriesByOrg, ...loaded } }))
      },

      // Given plain names (from an AI suggestion or a WordPress import),
      // the matching category ids, creating any that don't exist yet.
      // Lenient: a name that fails to create is skipped rather than
      // aborting the batch -- right for a best-effort suggestion or a
      // many-post import, not for the editor's explicit "+ Add" (see
      // addCategory).
      async resolveCategoryIds(names, orgId) {
        const ids = []
        for (const rawName of names) {
          const name = rawName.trim()
          if (!name) continue
          const existing = (get().categoriesByOrg[orgId] ?? []).find((c) => sameName(c.name, name))
          if (existing) {
            ids.push(existing.id)
            continue
          }
          const { row } = await findOrCreate('categories', { organization_id: orgId }, name)
          if (!row) continue
          addCategoryRow(orgId, row)
          ids.push(row.id)
        }
        return ids
      },

      // The same for the signed-in author's tags (loadTags first).
      async resolveTagIds(names) {
        const authorId = get().tagsAuthorId
        if (!authorId) throw new Error('resolveTagIds before loadTags')
        const ids = []
        for (const rawName of names) {
          const name = rawName.trim()
          if (!name) continue
          const existing = get().tags.find((t) => sameName(t.name, name))
          if (existing) {
            ids.push(existing.id)
            continue
          }
          const { row } = await findOrCreate('tags', { author_id: authorId }, name)
          if (!row) continue
          addTagRow(row)
          ids.push(row.id)
        }
        return ids
      },

      // The editor's explicit actions -- strict, returning the error for
      // the editor to show, unlike the lenient resolvers above.
      async addCategory(orgId, name) {
        const { data, error } = await client
          .from('categories')
          .insert({ organization_id: orgId, name })
          .select('id, name')
          .single()
        if (!error) addCategoryRow(orgId, data)
        return { category: data, error }
      },

      // Categories are blog-wide: this removes it from every post using it.
      async deleteCategory(orgId, categoryId) {
        const { error } = await client.from('categories').delete().eq('id', categoryId)
        if (!error) {
          set((s) => ({
            categoriesByOrg: {
              ...s.categoriesByOrg,
              [orgId]: (s.categoriesByOrg[orgId] ?? []).filter((c) => c.id !== categoryId),
            },
          }))
        }
        return { error }
      },

      async createTag(name) {
        const authorId = get().tagsAuthorId
        // Whose tag this is comes from loadTags.
        if (!authorId) return { tag: null, error: new Error('Your tags are still loading. Try again in a moment.') }
        const { row, error } = await findOrCreate('tags', { author_id: authorId }, name)
        if (row && !get().tags.some((t) => t.id === row.id)) addTagRow(row)
        return { tag: row ?? null, error: error ?? null }
      },
    }
  })
}
