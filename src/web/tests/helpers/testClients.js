import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { totp } from './totp.js'

config({ path: '.env.test.local' })

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mailpitUrl = process.env.MAILPIT_URL || 'http://127.0.0.1:54324'

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
// enable_confirmations is on (matches production -- see
// supabase/config.toml), so a fresh signUp() no longer returns a
// session; a real user has to click the link in their confirmation
// email first. This does the same thing a real user's click does --
// reads the actual email Supabase sent to the local Mailpit inbox and
// exchanges its token_hash for a session -- rather than bypassing the
// gate for tests.
async function findConfirmationTokenHash(email, { retries = 20, delayMs = 250 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const searchRes = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    const search = await searchRes.json()
    if (search.messages?.length) {
      const messageRes = await fetch(`${mailpitUrl}/api/v1/message/${search.messages[0].ID}`)
      const message = await messageRes.json()
      const match = message.Text.match(/token=([a-f0-9]+)&type=signup/)
      if (match) return match[1]
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  throw new Error(`No confirmation email found for ${email} after ${retries} attempts`)
}

// Completes signup on `client` (the same client that called signUp())
// by verifying the token_hash from that user's real confirmation
// email, and returns the resulting { user, session } -- the session
// signUp() itself no longer provides directly.
//
// Two-factor is required for every account (20261006100000_require_mfa
// .sql) -- the database refuses a session that hasn't completed it -- so
// by default this also does what a new user's first visit does: adds an
// authenticator and enters its first code, leaving `client` fully
// logged in. Pass { mfa: false } to stop at the password-only step.
const totpSecrets = new Map()

export async function confirmSignup(client, email, { mfa = true } = {}) {
  const tokenHash = await findConfirmationTokenHash(email)
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' })
  if (error) throw error
  if (!mfa) return data

  const { data: factor, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
  if (enrollError) throw enrollError
  totpSecrets.set(email, factor.totp.secret)
  const { data: verified, error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: totp(factor.totp.secret),
  })
  if (verifyError) throw verifyError
  return { user: verified.user, session: verified }
}

// Logs an existing user (one set up through confirmSignup in this same
// run) back in the way a real user does: password, then a current code.
export async function signInWithMfa(client, email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  const secret = totpSecrets.get(email)
  if (!secret) throw new Error(`No authenticator secret recorded for ${email} -- was it created via confirmSignup?`)
  const { data: factors } = await client.auth.mfa.listFactors()
  const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
    factorId: factors.totp[0].id,
    code: totp(secret),
  })
  if (verifyError) throw verifyError
}

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
