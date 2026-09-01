import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.test.local' })

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Copy ' +
      '.env.test.example to .env.test.local and fill in values from `npx supabase status` ' +
      '(the local stack must be running: `npx supabase start`).',
  )
}

// A fresh anon-key client per call, matching what the real app uses --
// each test user needs their own client so their auth session doesn't
// clobber another user's in the same test run.
export function createTestClient() {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Bypasses RLS entirely -- only for test setup/teardown (e.g. deleting
// the users this run created), never for the assertions themselves.
// Assertions should go through createTestClient() so they're actually
// exercising RLS, the same way a real user would.
export const adminClient = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Deletes orgs first (memberships/posts/subscriptions cascade from
// them), then users (profiles cascade from that) -- organizations.owner_id
// has no ON DELETE CASCADE back to auth.users, so deleting a user out
// of order fails.
//
// One known, harmless exception: whichever reader happens to be the
// very first ever (in a given local DB's lifetime) becomes the shared
// BDLReaders org's owner. That org is intentionally never in
// `orgIds` (every test run's users join or create it, but no run
// "owns" deleting a platform-wide shared resource), so that one
// user's deleteUser call fails the same way -- correctly, since you
// can't delete an org's sole owner without reassigning it first. This
// logs a warning rather than silently swallowing it, but doesn't fail
// the suite: it happens at most once per database, not per run.
export async function cleanupTestData(orgIds, userIds) {
  for (const orgId of orgIds) {
    const { error } = await adminClient.from('organizations').delete().eq('id', orgId)
    if (error) console.warn(`cleanup: failed to delete organization ${orgId}:`, error.message)
  }
  for (const userId of userIds) {
    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) console.warn(`cleanup: failed to delete user ${userId}:`, error.message)
  }
}
