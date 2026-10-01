// Hands the editor's current, possibly unsaved, post to the preview tab
// (/posts/preview). localStorage rather than the database: nothing has
// to be saved to preview it, and localStorage is the one store a
// same-origin tab opened with window.open can read (sessionStorage is
// per-tab). Each editor writes under its own id, so two posts being
// edited side by side don't overwrite each other's preview.
const KEY_PREFIX = 'post-preview:'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

function read(storage, key) {
  try {
    return JSON.parse(storage.getItem(key))
  } catch {
    return null
  }
}

// Also drops any preview older than a day, so entries from editors that
// were closed long ago don't pile up. Throws if the browser refuses the
// write (storage disabled or full) -- the caller reports that.
export function savePostPreview(id, draft, storage = window.localStorage, now = Date.now()) {
  const stale = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key.startsWith(KEY_PREFIX)) continue
    const savedAt = read(storage, key)?.savedAt
    if (typeof savedAt !== 'number' || now - savedAt > MAX_AGE_MS) stale.push(key)
  }
  for (const key of stale) storage.removeItem(key)

  storage.setItem(KEY_PREFIX + id, JSON.stringify({ ...draft, savedAt: now }))
}

// Null when there's nothing stored under that id (never previewed,
// expired, or a different browser).
export function loadPostPreview(id, storage = window.localStorage) {
  const draft = read(storage, KEY_PREFIX + id)
  return draft && typeof draft === 'object' ? draft : null
}
