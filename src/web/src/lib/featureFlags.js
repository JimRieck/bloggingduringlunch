import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient.js'

// Module-level, fetched once and shared across every component that asks
// for it -- same caching approach as postMeta.js's orgCache/authorCache.
// Flags rarely change; a full page reload is what picks up a change made
// elsewhere (e.g. a site admin flipping one in the database directly).
let flagsPromise = null

function fetchFlags() {
  if (!flagsPromise) {
    flagsPromise = supabase
      .from('feature_flags')
      .select('key, enabled')
      .then(({ data }) => Object.fromEntries((data ?? []).map((r) => [r.key, r.enabled])))
  }
  return flagsPromise
}

// Returns {} until loaded, so every flag reads as falsy (disabled) rather
// than briefly flashing AI buttons on before the real values arrive.
export function useFeatureFlags() {
  const [flags, setFlags] = useState({})

  useEffect(() => {
    let cancelled = false
    fetchFlags().then((loaded) => {
      if (!cancelled) setFlags(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return flags
}
