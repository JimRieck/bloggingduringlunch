import { useEffect } from 'react'
import { useFeatureFlagsStore } from '../stores/index.js'

// The site's feature flags as { key: enabled }, kept live from /admin.
// Returns {} until loaded, so every flag reads as disabled rather than
// briefly flashing AI buttons on. The state itself lives in
// stores/featureFlagsStore.js.
export function useFeatureFlags() {
  const flags = useFeatureFlagsStore((s) => s.flags)
  useEffect(() => {
    useFeatureFlagsStore.getState().start()
  }, [])
  return flags
}
