// @vitest-environment jsdom
//
// The editor's auto-save timing and bookkeeping (src/lib/useAutoSave.js),
// with a stand-in save function and fake timers -- no Supabase involved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useAutoSave } from '../../src/lib/useAutoSave.js'

let current
let save

function setup(options = {}) {
  current = { title: 'Hello', content: '<p>Hi</p>' }
  save = vi.fn(async () => 'saved')
  const hook = renderHook(() => useAutoSave({ getSnapshot: () => current, save, intervalMs: 30_000, ...options }))
  act(() => hook.result.current.markSaved({ ...current }))
  return hook
}

async function tick(ms = 30_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useAutoSave', () => {
  it('saves every 30 seconds, and only when something changed', async () => {
    const { result } = setup()
    await tick()
    expect(save).not.toHaveBeenCalled()

    current = { ...current, title: 'Hello world' }
    await tick(29_000)
    expect(save).not.toHaveBeenCalled()
    await tick(1_000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'Hello world', content: '<p>Hi</p>' })
    expect(result.current.status.state).toBe('saved')
    expect(result.current.status.savedAt).toBeInstanceOf(Date)

    await tick()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves nothing before markSaved says what is already stored', async () => {
    current = { title: 'Loading' }
    save = vi.fn(async () => 'saved')
    renderHook(() => useAutoSave({ getSnapshot: () => current, save, intervalMs: 30_000 }))
    await tick()
    expect(save).not.toHaveBeenCalled()
  })

  it('says it couldn’t save, then tries again on the next round', async () => {
    const { result } = setup()
    save.mockRejectedValueOnce(new Error('offline'))
    current = { ...current, title: 'Changed' }
    await tick()
    expect(result.current.status.state).toBe('error')
    expect(result.current.isDirty()).toBe(true)

    await tick()
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.status.state).toBe('saved')
    expect(result.current.isDirty()).toBe(false)
  })

  it('stops after a conflict, until markSaved', async () => {
    const { result } = setup()
    save.mockResolvedValueOnce('conflict')
    current = { ...current, title: 'Changed' }
    await tick()
    expect(result.current.status.state).toBe('conflict')

    current = { ...current, title: 'Changed again' }
    await tick()
    await tick()
    expect(save).toHaveBeenCalledTimes(1)

    act(() => result.current.markSaved({ ...current }))
    current = { ...current, title: 'And again' }
    await tick()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('a skipped save (nothing worth saving yet) is tried again later', async () => {
    const { result } = setup()
    save.mockResolvedValueOnce('skipped')
    current = { ...current, title: '' }
    await tick()
    expect(result.current.status.state).toBe('idle')
    expect(result.current.isDirty()).toBe(true)
    await tick()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves straight away when the tab is hidden', async () => {
    setup()
    current = { ...current, title: 'Switching apps' }
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(save).toHaveBeenCalledTimes(1)
    visibility.mockRestore()
  })

  it('warns before leaving with unsaved changes, and not otherwise', async () => {
    setup()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    current = { ...current, title: 'Not saved yet' }
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('pause waits for a save already on its way, and holds off further saves until resume', async () => {
    const { result } = setup()
    let finish
    save.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    current = { ...current, title: 'Slow save' }
    await tick()
    expect(result.current.status.state).toBe('saving')

    let paused = false
    const pausing = result.current.pause().then(() => (paused = true))
    await act(async () => {})
    expect(paused).toBe(false)
    await act(async () => {
      finish('saved')
      await pausing
    })
    expect(paused).toBe(true)

    current = { ...current, title: 'While paused' }
    await tick()
    expect(save).toHaveBeenCalledTimes(1)
    // No leave-page warning while paused (the editor is mid-Save/Publish).
    const leaving = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(false)

    act(() => result.current.resume())
    await tick()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('does nothing while disabled', async () => {
    setup({ enabled: false })
    current = { ...current, title: 'Changed' }
    await tick()
    expect(save).not.toHaveBeenCalled()
  })
})
