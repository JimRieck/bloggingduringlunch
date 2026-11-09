// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261109100100_random_social_schedules.sql: saving a reviewed
// random schedule (create_random_social_schedule) and everything it
// checks, who can see its slots, and how the existing worker functions
// move a random schedule from slot to slot. The planning itself is
// tests/lib/randomSchedule.test.js; posting to LinkedIn is checked by
// hand against a local stand-in, like the rest of LinkedIn posting.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const TZ = 'America/New_York'

const createdUserIds = []
const createdOrgIds = []

async function newAuthor(name) {
  const client = createTestClient()
  const { data: result, error } = await client.auth.signUp({
    email: emailFor(name),
    password: 'password123',
    options: { data: { username: `${name}-${runId}`, user_type: 'author', new_organization_name: `${name} Org ${runId}` } },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  await confirmSignup(client, emailFor(name))
  const { data: m } = await client.from('memberships').select('organization_id').eq('user_id', result.user.id).single()
  createdOrgIds.push(m.organization_id)
  return { client, id: result.user.id, orgId: m.organization_id }
}

async function newPost(author, title, status = 'published') {
  const { data, error } = await author.client
    .from('posts')
    .insert({
      organization_id: author.orgId,
      author_id: author.id,
      title,
      content: '<p>Body</p>',
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

const minutesFromNow = (m) => new Date(Date.now() + m * 60_000).toISOString()
const slot = (minutes, postId, message = `Post ${minutes}`) => ({ run_at: minutesFromNow(minutes), post_id: postId, message })

function create(author, slots, timezone = TZ) {
  return author.client.rpc('create_random_social_schedule', { p_timezone: timezone, p_slots: slots })
}

async function scheduleRow(id) {
  const { data } = await adminClient.from('scheduled_social_posts').select('*').eq('id', id).single()
  return data
}

async function slotsOf(id) {
  const { data } = await adminClient
    .from('scheduled_social_post_slots')
    .select('run_at, post_id, message, attempted_at')
    .eq('schedule_id', id)
    .order('run_at')
  return data
}

function complete(id, ok = true) {
  return adminClient.rpc('complete_social_post_run', {
    p_id: id,
    p_ok: ok,
    p_external_id: ok ? 'urn:li:share:1' : null,
    p_error: ok ? null : 'linkedin_500: boom',
    p_message: 'what went out',
  })
}

describe('random social schedules', () => {
  let owner
  let stranger
  let postA
  let postB
  let postC
  let draft
  let strangersPost

  beforeAll(async () => {
    owner = await newAuthor('random-owner')
    stranger = await newAuthor('random-stranger')
    postA = await newPost(owner, 'Post A')
    postB = await newPost(owner, 'Post B')
    postC = await newPost(owner, 'Post C')
    draft = await newPost(owner, 'A draft', 'draft')
    strangersPost = await newPost(stranger, "Someone else's post")
  })

  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('saving a reviewed plan', () => {
    it('saves one schedule with every slot exactly as reviewed, starting at the first', async () => {
      const plan = [slot(60, postA, 'First'), slot(120, postB, 'Second'), slot(24 * 60, postC, 'Third')]
      const { data: id, error } = await create(owner, plan)
      expect(error).toBeNull()

      const s = await scheduleRow(id)
      expect(s).toMatchObject({ recurrence: 'random', status: 'scheduled', post_id: null, messages: ['First'], timezone: TZ })
      expect(new Date(s.next_run_at).getTime()).toBe(new Date(plan[0].run_at).getTime())
      expect(new Date(s.ends_at).getTime()).toBe(new Date(plan[2].run_at).getTime())

      const saved = await slotsOf(id)
      expect(saved.map((x) => [x.post_id, x.message, x.attempted_at])).toEqual([
        [postA, 'First', null],
        [postB, 'Second', null],
        [postC, 'Third', null],
      ])
    })

    it('leaves out times that passed while the author was reviewing, and refuses a plan that has all passed', async () => {
      const { data: id } = await create(owner, [slot(-10, postA), slot(60, postB)])
      expect((await slotsOf(id)).map((x) => x.post_id)).toEqual([postB])

      const { error } = await create(owner, [slot(-10, postA)])
      expect(error.message).toMatch(/already passed/)
    })

    it.each([
      ['someone else’s post', () => [slot(60, strangersPost)], /your published posts/],
      ['a draft', () => [slot(60, draft)], /your published posts/],
      ['a slot with no post', () => [slot(60, null)], /your published posts/],
      ['an empty message', () => [slot(60, postA, '   ')], /between 1 and 3000/],
      ['an over-long message', () => [slot(60, postA, 'x'.repeat(3001))], /between 1 and 3000/],
      ['more than 90 days', () => [slot(60, postA), slot(60 + 93 * 24 * 60, postB)], /at most 90 days/],
    ])('refuses %s, saving nothing', async (_, plan, message) => {
      const before = (await adminClient.from('scheduled_social_posts').select('id').eq('user_id', owner.id)).data.length
      const { error } = await create(owner, plan())
      expect(error.message).toMatch(message)
      const after = (await adminClient.from('scheduled_social_posts').select('id').eq('user_id', owner.id)).data.length
      expect(after).toBe(before)
    })

    it('refuses more than 5 posts in one day of the schedule’s time zone', async () => {
      // Six slots on one New York day: noon tomorrow, then every 10 minutes.
      const noon = new Date()
      noon.setUTCDate(noon.getUTCDate() + 1)
      noon.setUTCHours(17, 0, 0, 0)
      const plan = Array.from({ length: 6 }, (_, i) => ({
        run_at: new Date(noon.getTime() + i * 600_000).toISOString(),
        post_id: [postA, postB, postC][i % 3],
        message: `Six ${i}`,
      }))
      const { error } = await create(owner, plan)
      expect(error.message).toMatch(/at most 5 posts a day/)

      const { error: fiveOk } = await create(owner, plan.slice(0, 5))
      expect(fiveOk).toBeNull()
    })

    it('refuses an unknown time zone and a plan that isn’t a list', async () => {
      expect((await create(owner, [slot(60, postA)], 'Mars/Olympus')).error).not.toBeNull()
      expect((await owner.client.rpc('create_random_social_schedule', { p_timezone: TZ, p_slots: { a: 1 } })).error.message).toMatch(
        /must be a list/,
      )
    })

    it('can’t be bypassed with a plain insert, which would make a random schedule with nothing to post', async () => {
      const { error } = await owner.client.from('scheduled_social_posts').insert({
        messages: ['Sneaky'],
        first_run_at: minutesFromNow(60),
        timezone: TZ,
        recurrence: 'random',
      })
      expect(error.message).toMatch(/create_random_social_schedule/)
    })
  })

  describe('who can see the slots', () => {
    let id

    beforeAll(async () => {
      id = (await create(owner, [slot(90, postA), slot(180, postB)])).data
    })

    it('only the schedule’s owner', async () => {
      const mine = await owner.client.from('scheduled_social_post_slots').select('post_id').eq('schedule_id', id)
      expect(mine.data).toHaveLength(2)
      const theirs = await stranger.client.from('scheduled_social_post_slots').select('post_id').eq('schedule_id', id)
      expect(theirs.data).toEqual([])
      const anon = await createTestClient().from('scheduled_social_post_slots').select('post_id').eq('schedule_id', id)
      expect(anon.data ?? []).toEqual([])
    })

    it('and not even the owner can add or change one directly', async () => {
      const insert = await owner.client
        .from('scheduled_social_post_slots')
        .insert({ schedule_id: id, run_at: minutesFromNow(300), post_id: postC, message: 'Extra' })
      expect(insert.error).not.toBeNull()
      await owner.client.from('scheduled_social_post_slots').update({ message: 'Changed' }).eq('schedule_id', id)
      expect((await slotsOf(id)).map((x) => x.message)).not.toContain('Changed')
    })

    it('the scheduler lists the remaining slots as what’s coming up', async () => {
      const { data } = await owner.client.rpc('upcoming_social_runs', { p_schedule_id: id, p_count: 5 })
      expect(data).toHaveLength(2)
      expect(new Date(data[0].run_at).getTime()).toBe(new Date((await slotsOf(id))[0].run_at).getTime())
    })
  })

  describe('moving from slot to slot', () => {
    it('marks the slot that ran and moves on to the next; finishes after the last', async () => {
      const { data: id } = await create(owner, [slot(30, postA), slot(60, postB)])
      const slots = await slotsOf(id)

      await complete(id)
      let s = await scheduleRow(id)
      expect(s).toMatchObject({ status: 'scheduled', run_count: 1 })
      expect(new Date(s.next_run_at).getTime()).toBe(new Date(slots[1].run_at).getTime())
      expect((await slotsOf(id))[0].attempted_at).not.toBeNull()

      await complete(id)
      s = await scheduleRow(id)
      expect(s).toMatchObject({ status: 'completed', next_run_at: null, run_count: 2 })
    })

    it('a slot run early ("Post now") isn’t run again at its own time', async () => {
      const { data: id } = await create(owner, [slot(120, postA), slot(240, postB)])
      const slots = await slotsOf(id)
      await complete(id) // runs the 2-hours-from-now slot now
      const s = await scheduleRow(id)
      expect(new Date(s.next_run_at).getTime()).toBe(new Date(slots[1].run_at).getTime())
    })

    it('skips slots missed while the app was down instead of posting a backlog', async () => {
      const { data: id } = await create(owner, [slot(30, postA), slot(60, postB), slot(90, postC), slot(120, postA, 'Later')])
      // Pretend the first three times passed while nothing was running.
      const past = [-90, -60, -30]
      const slots = await slotsOf(id)
      for (let i = 0; i < 3; i += 1) {
        await adminClient
          .from('scheduled_social_post_slots')
          .update({ run_at: minutesFromNow(past[i]) })
          .eq('schedule_id', id)
          .eq('run_at', slots[i].run_at)
      }
      await adminClient.from('scheduled_social_posts').update({ next_run_at: minutesFromNow(-90) }).eq('id', id)

      await complete(id)
      const s = await scheduleRow(id)
      expect(new Date(s.next_run_at).getTime()).toBe(new Date(slots[3].run_at).getTime())
      expect(s.status).toBe('scheduled')
    })

    it('keeps going after an ordinary failure', async () => {
      const { data: id } = await create(owner, [slot(30, postA), slot(60, postB)])
      await complete(id, false)
      const s = await scheduleRow(id)
      expect(s).toMatchObject({ status: 'scheduled', last_error: 'linkedin_500: boom' })
    })

    it('resuming after a pause carries on from the next slot still ahead', async () => {
      const { data: id } = await create(owner, [slot(30, postA), slot(60, postB), slot(90, postC)])
      const slots = await slotsOf(id)
      await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: true })
      expect((await scheduleRow(id)).status).toBe('paused')

      // The first slot passes while paused.
      await adminClient
        .from('scheduled_social_post_slots')
        .update({ run_at: minutesFromNow(-5) })
        .eq('schedule_id', id)
        .eq('run_at', slots[0].run_at)
      await adminClient.from('scheduled_social_posts').update({ next_run_at: minutesFromNow(-5) }).eq('id', id)

      await owner.client.rpc('set_social_post_paused', { p_id: id, p_paused: false })
      const s = await scheduleRow(id)
      expect(s.status).toBe('scheduled')
      expect(new Date(s.next_run_at).getTime()).toBe(new Date(slots[1].run_at).getTime())
    })

    it('deleting the schedule deletes its slots', async () => {
      const { data: id } = await create(owner, [slot(30, postA)])
      await owner.client.from('scheduled_social_posts').delete().eq('id', id)
      expect(await slotsOf(id)).toEqual([])
    })
  })

  it('has no repeat formula, so the daily/weekly/monthly math can never be applied to it', async () => {
    const { data } = await adminClient.rpc('social_next_run', {
      first_run: '2026-01-05T14:00:00Z',
      tz: TZ,
      rec: 'random',
      after_ts: '2026-01-05T14:00:00Z',
    })
    expect(data).toBeNull()
  })
})
