import { useCallback, useEffect, useRef, useState } from 'react'

export const AUTO_SAVE_INTERVAL_MS = 30_000

// Saves whatever is being edited every `intervalMs`, but only when it has
// actually changed since the last save -- plus straight away when the tab
// is hidden (switching apps on a phone, closing the tab), and it asks the
// browser to warn before leaving with unsaved changes.
//
// The caller provides:
//   getSnapshot() -> a plain object of what's being edited, or null while
//     it isn't ready (compared as JSON, so keep it to plain values);
//   save(snapshot) -> resolves 'saved', 'skipped' (nothing worth saving
//     yet, e.g. a blank new post) or 'conflict' (someone else changed it
//     -- auto-save stops until markSaved is called); throws on failure,
//     which is retried on the next interval.
// and calls markSaved(snapshot) once the editor holds what's stored (on
// load, and after its own explicit saves). Nothing is auto-saved before
// that first markSaved.
export function useAutoSave({ getSnapshot, save, enabled = true, intervalMs = AUTO_SAVE_INTERVAL_MS }) {
  const [status, setStatus] = useState({ state: 'idle', savedAt: null })
  const savedRef = useRef(null)
  const inFlightRef = useRef(null)
  const pausedRef = useRef(false)
  const conflictRef = useRef(false)
  const getSnapshotRef = useRef(getSnapshot)
  const saveRef = useRef(save)

  useEffect(() => {
    getSnapshotRef.current = getSnapshot
    saveRef.current = save
  })

  const isDirty = useCallback(() => {
    if (savedRef.current === null) return false
    const snapshot = getSnapshotRef.current()
    return snapshot !== null && JSON.stringify(snapshot) !== savedRef.current
  }, [])

  const markSaved = useCallback((snapshot, savedAt = null) => {
    savedRef.current = JSON.stringify(snapshot)
    conflictRef.current = false
    setStatus(savedAt ? { state: 'saved', savedAt } : { state: 'idle', savedAt: null })
  }, [])

  const flush = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current
    if (pausedRef.current || conflictRef.current || savedRef.current === null) return
    const snapshot = getSnapshotRef.current()
    if (snapshot === null) return
    const serialized = JSON.stringify(snapshot)
    if (serialized === savedRef.current) return

    const run = (async () => {
      setStatus((s) => ({ ...s, state: 'saving' }))
      try {
        const result = await saveRef.current(snapshot)
        if (result === 'conflict') {
          conflictRef.current = true
          setStatus((s) => ({ ...s, state: 'conflict' }))
        } else if (result === 'skipped') {
          setStatus((s) => ({ ...s, state: s.savedAt ? 'saved' : 'idle' }))
        } else {
          savedRef.current = serialized
          setStatus({ state: 'saved', savedAt: new Date() })
        }
      } catch {
        setStatus((s) => ({ ...s, state: 'error' }))
      }
    })()
    inFlightRef.current = run
    try {
      await run
    } finally {
      inFlightRef.current = null
    }
  }, [])

  // For the editor's own Save/Publish: stop auto-saving, and wait for any
  // save already on its way so the two can't race.
  const pause = useCallback(async () => {
    pausedRef.current = true
    await inFlightRef.current
  }, [])

  const resume = useCallback(() => {
    pausedRef.current = false
  }, [])

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(flush, intervalMs)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const onBeforeUnload = (event) => {
      if (!pausedRef.current && isDirty()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [enabled, intervalMs, flush, isDirty])

  return { status, markSaved, flush, pause, resume, isDirty }
}
