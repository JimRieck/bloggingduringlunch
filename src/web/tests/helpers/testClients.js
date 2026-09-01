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
