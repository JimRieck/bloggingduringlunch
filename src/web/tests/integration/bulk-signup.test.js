// Bulk/volume integration test: 50 randomized signups across all
// three account paths (reader, author creating an org, author joining
// one via invite code), run in concurrent batches against the real
// local Supabase stack.
//
// Deliberately uses a *small* pool of organization names so that many
// of the ~50 signups are likely to pick the same name -- this
// exercises the slug-collision-suffix loop in handle_new_user under
// real concurrent inserts (multiple authors in the same batch racing
// to create an org with the same name), not just in isolation with
// guaranteed-unique names.
import { afterAll, describe, expect, it } from 'vitest'
import { adminClient, cleanupTestData, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const USER_COUNT = 50
const BATCH_SIZE = 10
const PASSWORD = 'password123'

const FIRST_NAMES = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack',
  'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Ruth', 'Sam', 'Tara',
]
const LAST_NAMES = ['Smith', 'Jones', 'Lee', 'Brown', 'Garcia', 'Patel', 'Kim', 'Chen', 'Diaz', 'Khan']
const ORG_NAME_POOL = [
  'Tech Blog', 'Daily Notes', 'Dev Diary', 'Code Journal', 'Weekend Hacks',
  'Morning Standup', 'Late Night Debug', 'Shipping Log', 'Build Notes', 'Terminal Thoughts',
]

function randomItem(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomUsername(index) {
  const name = `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`
  return { name, username: name.toLowerCase().replace(/\s+/g, '.') + '.' + index }
}

const createdUserIds = []
const createdOrgIds = []

// `joinableOrgs` is a snapshot of orgs this test has already created,
// as of the start of the current batch -- orgs created within the
// same batch aren't available to join until the next one, since a
// batch runs concurrently.
async function signUpOne(index, joinableOrgs) {
  const client = createTestClient()
  const { username } = randomUsername(index)
  const email = `${username}.${runId}@example.com`

  const roll = Math.random()
  let intent
  if (roll < 0.4) {
    intent = 'reader'
  } else if (roll < 0.7 || joinableOrgs.length === 0) {
    intent = 'author-create'
  } else {
    intent = 'author-join'
  }

  const metadata = { username, user_type: intent === 'reader' ? 'reader' : 'author' }
  if (intent === 'author-create') {
    metadata.new_organization_name = randomItem(ORG_NAME_POOL)
  } else if (intent === 'author-join') {
    metadata.invite_code = randomItem(joinableOrgs).inviteCode
  }

  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: metadata },
  })

  if (error) {
    return { intent, email, error }
  }
  createdUserIds.push(data.user.id)

  const { data: membership, error: membershipError } = await client
    .from('memberships')
    .select('role, organizations(id, name, slug, invite_code)')
    .eq('user_id', data.user.id)
    .maybeSingle()

  return { intent, email, userId: data.user.id, membership, membershipError }
}

describe('bulk signup: 50 randomized users', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  it(
    'creates 50 users across reader/author-create/author-join with no errors',
    async () => {
      const joinableOrgs = []
      const results = []

      for (let start = 0; start < USER_COUNT; start += BATCH_SIZE) {
        const batchIndexes = Array.from(
          { length: Math.min(BATCH_SIZE, USER_COUNT - start) },
          (_, i) => start + i,
        )
        const availableToJoin = [...joinableOrgs]
        const batchResults = await Promise.all(
          batchIndexes.map((index) => signUpOne(index, availableToJoin)),
        )
        results.push(...batchResults)

        for (const result of batchResults) {
          if (!result.error && result.intent === 'author-create' && result.membership) {
            const org = result.membership.organizations
            createdOrgIds.push(org.id)
            joinableOrgs.push({ id: org.id, inviteCode: org.invite_code })
          }
        }
      }

      expect(results).toHaveLength(USER_COUNT)

      const errors = results.filter((r) => r.error)
      expect(
        errors,
        JSON.stringify(errors.map((e) => ({ email: e.email, message: e.error?.message }))),
      ).toHaveLength(0)

      const readers = results.filter((r) => r.intent === 'reader')
      const creators = results.filter((r) => r.intent === 'author-create')
      const joiners = results.filter((r) => r.intent === 'author-join')

      // The random split should realistically produce a mix of all
      // three across 50 users -- would only fail if Math.random()
      // were somehow degenerate.
      expect(readers.length).toBeGreaterThan(0)
      expect(creators.length).toBeGreaterThan(0)

      for (const r of readers) {
        expect(r.membershipError, r.email).toBeNull()
        expect(r.membership.organizations.slug, r.email).toBe('bdlreaders')
      }
      for (const r of creators) {
        expect(r.membershipError, r.email).toBeNull()
        expect(r.membership.role, r.email).toBe('owner')
      }
      for (const r of joiners) {
        expect(r.membershipError, r.email).toBeNull()
        expect(r.membership.role, r.email).toBe('editor')
      }

      // The actual point of the small, collision-prone name pool:
      // confirm every org this run created still got a unique slug,
      // even with (likely) duplicate names created concurrently
      // within the same batch.
      const { data: orgs } = await adminClient
        .from('organizations')
        .select('slug')
        .in('id', createdOrgIds)
      const slugs = orgs.map((o) => o.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
    },
    60000,
  )
})
