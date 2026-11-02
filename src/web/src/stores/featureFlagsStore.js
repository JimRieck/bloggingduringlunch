import { create } from 'zustand'

// The site's feature flags (feature_flags), loaded once and then kept
// live: a flag flipped on /admin reaches every open tab through Realtime
// straight away, with no reload. This is what lib/featureFlags.js used
// to do by hand with a module-level cache and a set of listeners.
//
// The feature_flags select policy is `using (true)` (anyone can read),
// so Realtime's own RLS check on the change feed passes for every
// client without any extra grant.
export function createFeatureFlagsStore(client) {
  return create((set, get) => ({
    // {} until loaded, so every flag reads as falsy (disabled) rather
    // than briefly flashing AI buttons on before the real values arrive.
    flags: {},
    loaded: false,
    started: false,

    // Safe to call from every component that needs flags: only the first
    // call loads them and opens the Realtime channel, which then lives as
    // long as the page.
    start() {
      if (get().started) return
      set({ started: true })

      client
        .from('feature_flags')
        .select('key, enabled')
        .then(({ data }) => {
          set({ flags: Object.fromEntries((data ?? []).map((r) => [r.key, r.enabled])), loaded: true })
        })

      client
        .channel('feature_flags-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, (payload) => {
          const row = payload.new
          // A change before the first load is already in what it returns.
          if (!row?.key || !get().loaded) return
          set((s) => ({ flags: { ...s.flags, [row.key]: row.enabled } }))
        })
        .subscribe()
    },

    // /admin's toggles. Updates the store as soon as the database
    // confirms, so the admin's own tab changes at once rather than when
    // the Realtime echo arrives (which then just repeats the same value).
    // RLS lets only site admins update a flag; for anyone else the update
    // matches no rows, which is reported as an error too.
    async setFlag(key, enabled) {
      const { data, error } = await client
        .from('feature_flags')
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select('key')
      if (error) return { error }
      if (!data?.length) return { error: new Error(`Not allowed to change ${key}`) }
      set((s) => ({ flags: { ...s.flags, [key]: enabled } }))
      return { error: null }
    },
  }))
}
