import { describe, expect, it } from 'vitest'
import { loadPostPreview, savePostPreview } from '../../src/lib/postPreview.js'

// The slice of the Web Storage API postPreview.js uses -- these tests
// run under Node, where there is no window.localStorage.
function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial))
  return {
    get length() {
      return items.size
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    keys: () => [...items.keys()],
  }
}

const HOUR = 60 * 60 * 1000
const draft = { organizationName: 'My Blog', post: { title: 'Hello', content: '<p>Hi</p>' } }

describe('savePostPreview / loadPostPreview', () => {
  it('round-trips a draft under its own id', () => {
    const storage = fakeStorage()
    savePostPreview('abc', draft, storage, 1000)
    expect(loadPostPreview('abc', storage)).toEqual({ ...draft, savedAt: 1000 })
  })

  it('keeps two editors’ previews separate', () => {
    const storage = fakeStorage()
    savePostPreview('one', { post: { title: 'First' } }, storage)
    savePostPreview('two', { post: { title: 'Second' } }, storage)
    expect(loadPostPreview('one', storage).post.title).toBe('First')
    expect(loadPostPreview('two', storage).post.title).toBe('Second')
  })

  it('overwrites the same id on a second save, so re-previewing shows the latest edit', () => {
    const storage = fakeStorage()
    savePostPreview('abc', { post: { title: 'Old' } }, storage)
    savePostPreview('abc', { post: { title: 'New' } }, storage)
    expect(loadPostPreview('abc', storage).post.title).toBe('New')
    expect(storage.length).toBe(1)
  })

  it('returns null for an id that was never saved', () => {
    expect(loadPostPreview('missing', fakeStorage())).toBeNull()
  })

  it('returns null rather than throwing when the stored value is corrupt', () => {
    const storage = fakeStorage({ 'post-preview:bad': '{not json' })
    expect(loadPostPreview('bad', storage)).toBeNull()
  })

  it('drops previews older than a day on the next save, and keeps recent ones', () => {
    const storage = fakeStorage()
    const now = 100 * HOUR
    savePostPreview('old', draft, storage, now - 25 * HOUR)
    savePostPreview('recent', draft, storage, now - 23 * HOUR)
    savePostPreview('new', draft, storage, now)
    expect(storage.keys().sort()).toEqual(['post-preview:new', 'post-preview:recent'])
  })

  it('also drops a corrupt preview entry, but never touches other keys in localStorage', () => {
    const storage = fakeStorage({ 'post-preview:bad': '{not json', 'sb-auth-token': 'keep me', other: '{}' })
    savePostPreview('new', draft, storage)
    expect(storage.keys().sort()).toEqual(['other', 'post-preview:new', 'sb-auth-token'])
  })
})
