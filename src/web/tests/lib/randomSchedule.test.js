import { describe, expect, it } from 'vitest'
import {
  MAX_RANDOM_DAYS,
  groupSlotsByDay,
  planRandomSchedule,
  randomPlanProblem,
  shuffle,
} from '../../src/lib/randomSchedule.js'

// A small seeded generator (mulberry32), so every plan here is repeatable.
function seeded(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const posts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, title: `Post ${id}` }))
// A Sunday morning, before any window of the plans below opens.
const now = new Date(2026, 10, 8, 6, 0)

function plan(overrides = {}) {
  return planRandomSchedule({
    posts,
    perDay: 3,
    startDate: '2026-11-09',
    endDate: '2026-11-15',
    windowStart: '09:00',
    windowEnd: '17:00',
    now,
    random: seeded(42),
    ...overrides,
  })
}

const minuteOfDay = (d) => d.getHours() * 60 + d.getMinutes()
const dayOf = (d) => d.toDateString()

describe('planRandomSchedule', () => {
  it('plans exactly N posts a day, every day from the start date to the end date', () => {
    const slots = plan()
    expect(slots).toHaveLength(3 * 7)
    const perDay = new Map()
    for (const s of slots) perDay.set(dayOf(s.runAt), (perDay.get(dayOf(s.runAt)) ?? 0) + 1)
    expect([...perDay.values()]).toEqual([3, 3, 3, 3, 3, 3, 3])
    expect(dayOf(slots[0].runAt)).toBe(new Date(2026, 10, 9).toDateString())
    expect(dayOf(slots.at(-1).runAt)).toBe(new Date(2026, 10, 15).toDateString())
  })

  it('keeps every time inside the window, one in each third of it, in time order', () => {
    const slots = plan()
    for (let i = 0; i < slots.length; i += 1) {
      const m = minuteOfDay(slots[i].runAt)
      const third = i % 3
      expect(m).toBeGreaterThanOrEqual(9 * 60 + third * 160)
      expect(m).toBeLessThan(9 * 60 + (third + 1) * 160)
      if (i > 0) expect(slots[i].runAt > slots[i - 1].runAt).toBe(true)
    }
  })

  it('uses every post once before repeating any, and never the same post twice in a row', () => {
    const slots = plan({ perDay: 2, endDate: '2026-11-20' })
    const ids = slots.map((s) => s.post.id)
    for (let start = 0; start + posts.length <= ids.length; start += posts.length) {
      expect(new Set(ids.slice(start, start + posts.length)).size).toBe(posts.length)
    }
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).not.toBe(ids[i - 1])
  })

  it('never posts the same blog post twice in one day when there are enough posts', () => {
    const slots = plan({ perDay: 4, endDate: '2026-12-31', random: seeded(7) })
    const byDay = new Map()
    for (const s of slots) {
      const day = dayOf(s.runAt)
      byDay.set(day, [...(byDay.get(day) ?? []), s.post.id])
    }
    for (const ids of byDay.values()) expect(new Set(ids).size).toBe(ids.length)
  })

  it('still alternates when there are just two posts', () => {
    const two = posts.slice(0, 2)
    const ids = plan({ posts: two, perDay: 3 }).map((s) => s.post.id)
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]).not.toBe(ids[i - 1])
  })

  it('leaves out times that have already passed today', () => {
    const midMorning = new Date(2026, 10, 9, 12, 0)
    const slots = plan({ now: midMorning, perDay: 4, endDate: '2026-11-09' })
    expect(slots.length).toBeLessThan(4)
    for (const s of slots) expect(s.runAt.getTime()).toBeGreaterThan(midMorning.getTime() + 5 * 60_000)
  })

  it('is random: different seeds give different plans, the same seed the same plan', () => {
    const a = plan({ random: seeded(1) }).map((s) => `${s.runAt.getTime()}:${s.post.id}`)
    const b = plan({ random: seeded(2) }).map((s) => `${s.runAt.getTime()}:${s.post.id}`)
    const a2 = plan({ random: seeded(1) }).map((s) => `${s.runAt.getTime()}:${s.post.id}`)
    expect(a).not.toEqual(b)
    expect(a).toEqual(a2)
  })
})

describe('randomPlanProblem', () => {
  const ok = { posts, perDay: 3, startDate: '2026-11-09', endDate: '2026-11-15', windowStart: '09:00', windowEnd: '17:00', now }

  it('accepts sensible settings', () => {
    expect(randomPlanProblem(ok)).toBeNull()
  })

  it.each([
    [{ posts: posts.slice(0, 1) }, /at least two/],
    [{ perDay: 0 }, /between 1 and 5/],
    [{ perDay: 6 }, /between 1 and 5/],
    [{ endDate: '' }, /start and an end date/],
    [{ endDate: '2026-11-08' }, /on or after the start date/],
    [{ startDate: '2026-11-01', endDate: '2026-11-07' }, /already passed/],
    [{ endDate: '2027-03-01' }, new RegExp(`at most ${MAX_RANDOM_DAYS} days`)],
    [{ windowEnd: '08:00' }, /later than/],
    [{ perDay: 5, windowStart: '09:00', windowEnd: '10:00' }, /Widen the time window/],
  ])('%o is refused', (change, message) => {
    expect(randomPlanProblem({ ...ok, ...change })).toMatch(message)
  })
})

describe('shuffle', () => {
  it('keeps every item exactly once', () => {
    expect(shuffle([1, 2, 3, 4, 5], seeded(3)).sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('groupSlotsByDay', () => {
  it('groups by day in the given time zone, with day and time labels', () => {
    // 03:30 UTC on Nov 10 is still Nov 9 in New York.
    const days = groupSlotsByDay(
      [
        { runAt: '2026-11-09T15:00:00Z', post: posts[0] },
        { runAt: '2026-11-10T03:30:00Z', post: posts[1] },
        { runAt: '2026-11-10T15:00:00Z', post: posts[2] },
      ],
      'America/New_York',
    )
    expect(days.map((d) => d.slots.length)).toEqual([2, 1])
    expect(days[0].label).toMatch(/Nov 9/)
    expect(days[0].slots[1].time).toMatch(/10:30/)
  })
})
