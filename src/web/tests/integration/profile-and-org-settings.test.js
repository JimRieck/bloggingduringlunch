// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows. Covers the RLS policies
// the new profile/org-settings editing UI relies on: "Users can update
// own profile" (create_profiles.sql) and "Admins can update their
// organization" (create_organizations_and_memberships.sql, is_org_admin
// -- owner or admin, not just owner). Both policies already existed
// before this feature; these tests are new because nothing in the app
// previously exercised the UPDATE side of either one.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function signUp(client, email, data) {
  const { data: result, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  return confirmSignup(client, email)
}

describe('profile and organization settings', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  describe('editing a display name', () => {
    let userClient
    let userId

    beforeAll(async () => {
      userClient = createTestClient()
      const { user } = await signUp(userClient, emailFor('name-owner'), {
        username: 'name-owner-' + runId,
        user_type: 'author',
        new_organization_name: 'Name Test Org ' + runId,
      })
      userId = user.id
      const { data: membership } = await userClient
        .from('memberships')
        .select('organization_id')
        .eq('user_id', userId)
        .single()
      createdOrgIds.push(membership.organization_id)
    })

    it('a user can update their own display name', async () => {
      const { error } = await userClient
        .from('profiles')
        .update({ display_name: 'Renamed Person' })
        .eq('id', userId)
      expect(error).toBeNull()

      const { data } = await adminClient.from('profiles').select('display_name').eq('id', userId).single()
      expect(data.display_name).toBe('Renamed Person')
    })

    it("a stranger cannot update someone else's display name", async () => {
      const strangerClient = createTestClient()
      await signUp(strangerClient, emailFor('name-stranger'), {
        username: 'name-stranger-' + runId,
        user_type: 'reader',
      })

      const { error, count } = await strangerClient
        .from('profiles')
        .update({ display_name: 'Hijacked' }, { count: 'exact' })
        .eq('id', userId)
      // Same "RLS error or a silent zero-row update" shape as every
      // other `using()`-only policy in this codebase (see
      // categories-and-tags.test.js's post_tags case) -- assert
      // whichever PostgREST returns, then confirm via ground truth.
      if (!error) {
        expect(count).toBe(0)
      }

      const { data } = await adminClient.from('profiles').select('display_name').eq('id', userId).single()
      expect(data.display_name).toBe('Renamed Person')
    })
  })

  describe('editing an organization name', () => {
    let ownerClient
    let orgId
    let adminMemberClient
    let adminMemberId
    let editorClient

    beforeAll(async () => {
      ownerClient = createTestClient()
      const { user: owner } = await signUp(ownerClient, emailFor('org-owner'), {
        username: 'org-owner-' + runId,
        user_type: 'author',
        new_organization_name: 'Org Rename Test ' + runId,
      })
      const { data: ownerMembership } = await ownerClient
        .from('memberships')
        .select('organizations(id, invite_code)')
        .eq('user_id', owner.id)
        .single()
      orgId = ownerMembership.organizations.id
      createdOrgIds.push(orgId)

      // No signup path grants 'admin' directly (an invite grants
      // 'editor' -- see org_invite_codes.sql), and there's no
      // role-promotion UI yet either, so this sets it directly as test
      // setup, the same way a site admin would have to today.
      adminMemberClient = createTestClient()
      const { user: adminMember } = await signUp(adminMemberClient, emailFor('org-admin'), {
        username: 'org-admin-' + runId,
        user_type: 'author',
        invite_code: ownerMembership.organizations.invite_code,
      })
      adminMemberId = adminMember.id
      await adminClient
        .from('memberships')
        .update({ role: 'admin' })
        .eq('organization_id', orgId)
        .eq('user_id', adminMemberId)

      editorClient = createTestClient()
      await signUp(editorClient, emailFor('org-editor'), {
        username: 'org-editor-' + runId,
        user_type: 'author',
        invite_code: ownerMembership.organizations.invite_code,
      })
    })

    it('the owner can rename the organization', async () => {
      const { error } = await ownerClient.from('organizations').update({ name: 'Renamed By Owner' }).eq('id', orgId)
      expect(error).toBeNull()

      const { data } = await adminClient.from('organizations').select('name').eq('id', orgId).single()
      expect(data.name).toBe('Renamed By Owner')
    })

    it('an org admin (not just the owner) can also rename the organization', async () => {
      const { error } = await adminMemberClient
        .from('organizations')
        .update({ name: 'Renamed By Admin' })
        .eq('id', orgId)
      expect(error).toBeNull()

      const { data } = await adminClient.from('organizations').select('name').eq('id', orgId).single()
      expect(data.name).toBe('Renamed By Admin')
    })

    it('an editor (neither owner nor admin) cannot rename the organization', async () => {
      const { error, count } = await editorClient
        .from('organizations')
        .update({ name: 'Hijacked By Editor' }, { count: 'exact' })
        .eq('id', orgId)
      if (!error) {
        expect(count).toBe(0)
      }

      const { data } = await adminClient.from('organizations').select('name').eq('id', orgId).single()
      expect(data.name).toBe('Renamed By Admin')
    })

    it('a member of a different org cannot rename this one', async () => {
      const strangerClient = createTestClient()
      const { user: stranger } = await signUp(strangerClient, emailFor('org-stranger'), {
        username: 'org-stranger-' + runId,
        user_type: 'author',
        new_organization_name: 'Org Rename Stranger ' + runId,
      })
      const { data: strangerMembership } = await strangerClient
        .from('memberships')
        .select('organization_id')
        .eq('user_id', stranger.id)
        .single()
      createdOrgIds.push(strangerMembership.organization_id)

      const { error, count } = await strangerClient
        .from('organizations')
        .update({ name: 'Hijacked By Stranger' }, { count: 'exact' })
        .eq('id', orgId)
      if (!error) {
        expect(count).toBe(0)
      }

      const { data } = await adminClient.from('organizations').select('name').eq('id', orgId).single()
      expect(data.name).toBe('Renamed By Admin')
    })
  })
})
