import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

// Module-level cache shared across every component that asks for it --
// same approach as postMeta.js's orgCache/authorCache, extended with a
// live Realtime subscription (below) so a flag flipped from /admin
// updates every open tab immediately instead of needing a reload.
let cachedFlags = null
let loadPromise = null
const listeners = new Set()

function notifyListeners() {
  for (const setFlags of listeners) setFlags(cachedFlags)
}

function loadFlags() {
  if (!loadPromise) {
    loadPromise = supabase
      .from('feature_flags')
      .select('key, enabled')
      .then(({ data }) => {
        cachedFlags = Object.fromEntries((data ?? []).map((r) => [r.key, r.enabled]))
        return cachedFlags
      })
  }
  return loadPromise
}

// One shared Realtime channel for the whole app, created lazily on first
// use and never torn down (same lifetime as the module) -- every open
// tab gets pushed the new value the instant a site admin flips a
// toggle on /admin, rather than only picking it up on next page load.
// The feature_flags select policy is already `using (true)` (anyone can
// read), so Realtime's own RLS check on the change feed passes for
// every client without any extra grant.
let subscribed = false
function ensureSubscribed() {
  if (subscribed) return
  subscribed = true
  supabase
    .channel('feature_flags-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, (payload) => {
      const row = payload.new
      if (!row?.key || !cachedFlags) return
      cachedFlags = { ...cachedFlags, [row.key]: row.enabled }
      notifyListeners()
    })
    .subscribe()
}

// Returns {} until loaded, so every flag reads as falsy (disabled) rather
// than briefly flashing AI buttons on before the real values arrive.
export function useFeatureFlags() {
  const [flags, setFlags] = useState(cachedFlags ?? {})

  useEffect(() => {
    let cancelled = false
    ensureSubscribed()
    loadFlags().then((loaded) => {
      if (!cancelled) setFlags(loaded)
    })
    listeners.add(setFlags)
    return () => {
      cancelled = true
      listeners.delete(setFlags)
    }
  }, [])

  return flags
}
