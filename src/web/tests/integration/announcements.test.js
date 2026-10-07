// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Covers 20261007100000_announcements.sql (only site admins can see or
// write announcements; the browser can edit a draft's content but never
// its status, and nothing once it's sent; who counts as a recipient) and
// every way the send-announcement Edge Function refuses a request.
//
// Deliberately NOT exercised here: an actual send. The local functions
// may have a real Resend key, and every local test user has a fake
// @example.com address -- a real send would mail all of them. The
// batching itself is unit-tested with a fake fetch
// (tests/lib/batchEmail.test.js), and a full send was verified by hand
// against a local stand-in for Resend.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function newUser(name, { confirm = true, mfa = true } = {}) {
  const client = createTestClient()
  const { data, error } = await client.auth.signUp({
    email: emailFor(name),
    password: PASSWORD,
    options: { data: { username: `${name}-${runId}`, user_type: 'reader' } },
  })
  if (error) throw error
  createdUserIds.push(data.user.id)
  if (confirm) await confirmSignup(client, emailFor(name), { mfa })
  return { client, id: data.user.id, email: emailFor(name) }
}

async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('send-announcement', { body })
  if (error instanceof FunctionsHttpError) {
    return { status: error.context.status, body: await error.context.json().catch(() => null) }
  }
  return { status: 200, body: data }
}

const content = (subject) => ({
  subject,
  body_html: '<p>Hello</p>',
  email_html: '<!DOCTYPE html><p>Hello</p>',
  email_text: 'Hello',
})

describe('announcements', () => {
  let siteAdmin
  let member

  beforeAll(async () => {
    siteAdmin = await newUser('ann-admin')
    await adminClient.from('profiles').update({ is_site_admin: true }).eq('id', siteAdmin.id)
    member = await newUser('ann-member')
  })

  afterAll(async () => {
    await adminClient.from('announcements').delete().like('subject', `%${runId}%`)
    await cleanupTestData(createdOrgIds, createdUserIds)
  })

  describe('drafts', () => {
    it('a site admin can save a draft, and it records who wrote it', async () => {
      const { data, error } = await siteAdmin.client
        .from('announcements')
        .insert(content(`Draft ${runId}`))
        .select()
        .single()
      expect(error).toBeNull()
      expect(data).toMatchObject({ status: 'draft', created_by: siteAdmin.id, sent_at: null })
    })

    it('a site admin can edit a draft, which bumps its last-saved time', async () => {
      const { data: draft } = await siteAdmin.client
        .from('announcements')
        .insert(content(`Edit me ${runId}`))
        .select()
        .single()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const { data, error } = await siteAdmin.client
        .from('announcements')
        .update({ subject: `Edited ${runId}` })
        .eq('id', draft.id)
        .select()
        .single()
      expect(error).toBeNull()
      expect(data.subject).toBe(`Edited ${runId}`)
      expect(new Date(data.updated_at) > new Date(draft.updated_at)).toBe(true)
    })

    it("the browser can't set the status -- not on a new row, not on an existing one", async () => {
      const { error: insertError } = await siteAdmin.client
        .from('announcements')
        .insert({ ...content(`Sneaky ${runId}`), status: 'sent' })
      expect(insertError).not.toBeNull()

      const { data: draft } = await siteAdmin.client
        .from('announcements')
        .insert(content(`Status ${runId}`))
        .select()
        .single()
      const { error: updateError } = await siteAdmin.client
        .from('announcements')
        .update({ status: 'sent' })
        .eq('id', draft.id)
      expect(updateError).not.toBeNull()
    })

    it('a site admin can delete a draft', async () => {
      const { data: draft } = await siteAdmin.client
        .from('announcements')
        .insert(content(`Delete me ${runId}`))
        .select()
        .single()
      const { data } = await siteAdmin.client.from('announcements').delete().eq('id', draft.id).select()
      expect(data).toHaveLength(1)
    })
  })

  describe('once sent', () => {
    let sentId

    beforeAll(async () => {
      const { data } = await adminClient
        .from('announcements')
        .insert({ ...content(`Sent ${runId}`), status: 'sent', sent_at: new Date().toISOString(), recipient_count: 3 })
        .select()
        .single()
      sentId = data.id
    })

    it('stays visible to site admins as history', async () => {
      const { data } = await siteAdmin.client.from('announcements').select('id, status').eq('id', sentId)
      expect(data).toEqual([{ id: sentId, status: 'sent' }])
    })

    it("can't be edited or deleted", async () => {
      const { data: updated } = await siteAdmin.client
        .from('announcements')
        .update({ subject: 'Rewriting history' })
        .eq('id', sentId)
        .select()
      expect(updated).toEqual([])
      const { data: deleted } = await siteAdmin.client.from('announcements').delete().eq('id', sentId).select()
      expect(deleted).toEqual([])
    })

    it("can't be sent again", async () => {
      expect((await invoke(siteAdmin.client, { announcementId: sentId })).body).toEqual({ error: 'already_sent' })
    })
  })

  describe('non-admins', () => {
    it("can't see announcements or write one", async () => {
      const { data } = await member.client.from('announcements').select('id')
      expect(data).toEqual([])
      const { error } = await member.client.from('announcements').insert(content(`Member ${runId}`))
      expect(error).not.toBeNull()
    })

    it("can't count or list recipients, or claim a send", async () => {
      const { data: list } = await member.client.rpc('announcement_recipient_list')
      expect(list).toEqual([])
      const { error: listError } = await member.client.rpc('announcement_recipients')
      expect(listError).not.toBeNull()
      const { error: claimError } = await siteAdmin.client.rpc('claim_announcement_for_sending', {
        p_id: crypto.randomUUID(),
        p_sent_by: siteAdmin.id,
      })
      expect(claimError).not.toBeNull()
    })
  })

  describe('recipients', () => {
    it('are every confirmed, not-disabled account -- not unconfirmed signups or disabled users', async () => {
      const disabled = await newUser('ann-disabled')
      await adminClient.from('profiles').update({ disabled: true }).eq('id', disabled.id)
      const unconfirmed = await newUser('ann-unconfirmed', { confirm: false })

      const { data, error } = await adminClient.rpc('announcement_recipients')
      expect(error).toBeNull()
      const emails = data.map((r) => r.email)
      expect(emails).toContain(member.email)
      expect(emails).toContain(siteAdmin.email)
      expect(emails).not.toContain(disabled.email)
      expect(emails).not.toContain(unconfirmed.email)

      // The admin screen's checkbox list: the same people, with names.
      const { data: list } = await siteAdmin.client.rpc('announcement_recipient_list')
      expect(list.map((r) => r.email).sort()).toEqual([...emails].sort())
      expect(list.find((r) => r.user_id === member.id)).toMatchObject({ email: member.email })
      expect(list.find((r) => r.user_id === member.id).display_name).toBeTruthy()
    })
  })

  describe('choosing recipients', () => {
    it('a new draft goes to everyone (nobody unchecked), and the selection is saved with the draft', async () => {
      const { data: draft } = await siteAdmin.client
        .from('announcements')
        .insert(content(`Pick ${runId}`))
        .select()
        .single()
      expect(draft.excluded_user_ids).toEqual([])

      const { data, error } = await siteAdmin.client
        .from('announcements')
        .update({ excluded_user_ids: [member.id] })
        .eq('id', draft.id)
        .select()
        .single()
      expect(error).toBeNull()
      expect(data.excluded_user_ids).toEqual([member.id])
    })

    it('refuses to send with nobody selected, and leaves it a draft', async () => {
      const { data: everyone } = await adminClient.rpc('announcement_recipients')
      const { data: draft } = await siteAdmin.client
        .from('announcements')
        .insert({ ...content(`Nobody ${runId}`), excluded_user_ids: everyone.map((r) => r.user_id) })
        .select()
        .single()
      expect(await invoke(siteAdmin.client, { announcementId: draft.id })).toEqual({
        status: 400,
        body: { error: 'no_recipients' },
      })
      const { data } = await adminClient.from('announcements').select('status').eq('id', draft.id).single()
      expect(data.status).toBe('draft')
    })
  })

  describe('send-announcement refuses', () => {
    it('a non-admin', async () => {
      const { data: draft } = await adminClient.from('announcements').insert(content(`Refuse ${runId}`)).select().single()
      expect(await invoke(member.client, { announcementId: draft.id })).toMatchObject({ status: 403 })
    })

    it('an admin who has only entered their password', async () => {
      const client = createTestClient()
      await client.auth.signInWithPassword({ email: siteAdmin.email, password: PASSWORD })
      expect(await invoke(client, { announcementId: crypto.randomUUID() })).toMatchObject({ status: 401 })
    })

    it('an announcement that does not exist', async () => {
      expect(await invoke(siteAdmin.client, { announcementId: crypto.randomUUID() })).toMatchObject({ status: 404 })
    })

    it('a draft with no subject, leaving it a draft', async () => {
      const { data: draft } = await adminClient
        .from('announcements')
        .insert({ ...content(''), body_html: `<p>${runId}</p>`, subject: '' })
        .select()
        .single()
      await adminClient.from('announcements').update({ email_text: runId }).eq('id', draft.id)
      expect(await invoke(siteAdmin.client, { announcementId: draft.id })).toEqual({
        status: 400,
        body: { error: 'empty_announcement' },
      })
      const { data } = await adminClient.from('announcements').select('status').eq('id', draft.id).single()
      expect(data.status).toBe('draft')
      await adminClient.from('announcements').delete().eq('id', draft.id)
    })
  })
})
