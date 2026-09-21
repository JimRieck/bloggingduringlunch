import { getFeatureFlags } from '../_shared/featureFlags.ts'
import { API_BASE, OAUTH_BASE, serviceClient } from '../_shared/linkedin.ts'

const APP_URL = Deno.env.get('APP_URL') ?? 'https://bloggingduringlunch.com'
const STATE_MAX_AGE_MS = 15 * 60 * 1000

function back(result: 'connected' | 'error') {
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_URL}/social?linkedin=${result}` },
  })
}

// Step 2 of connecting LinkedIn. LinkedIn redirects the *browser* here
// (verify_jwt is off in config.toml -- there's no login on this request),
// so the only proof of who this is comes from the one-time `state` nonce
// linkedin-connect-start stored for them. The access token goes straight
// into a table no client can read and never appears in a URL or response.
Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams
  const code = params.get('code')
  const state = params.get('state')
  if (params.get('error') || !code || !state) {
    return back('error')
  }

  const { linkedin_posting: enabled } = await getFeatureFlags(['linkedin_posting'])
  const clientId = Deno.env.get('LINKEDIN_CLIENT_ID')
  const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET')
  const redirectUri = Deno.env.get('LINKEDIN_REDIRECT_URI')
  if (!enabled || !clientId || !clientSecret || !redirectUri) {
    return back('error')
  }

  const admin = serviceClient()

  // Single use: deleted on lookup whether or not the rest succeeds.
  const { data: stored } = await admin
    .from('linkedin_oauth_states')
    .select('user_id, created_at')
    .eq('state', state)
    .maybeSingle()
  await admin.from('linkedin_oauth_states').delete().eq('state', state)
  if (!stored || Date.now() - new Date(stored.created_at).getTime() > STATE_MAX_AGE_MS) {
    return back('error')
  }

  try {
    const tokenRes = await fetch(`${OAUTH_BASE}/oauth/v2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })
    if (!tokenRes.ok) {
      console.error('linkedin-oauth-callback: token exchange failed', tokenRes.status)
      return back('error')
    }
    const token = await tokenRes.json()

    const profileRes = await fetch(`${API_BASE}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    if (!profileRes.ok) {
      console.error('linkedin-oauth-callback: userinfo failed', profileRes.status)
      return back('error')
    }
    const profile = await profileRes.json()

    const { error } = await admin.from('linkedin_connections').upsert({
      user_id: stored.user_id,
      member_urn: `urn:li:person:${profile.sub}`,
      member_name: profile.name ?? null,
      access_token: token.access_token,
      expires_at: new Date(Date.now() + Number(token.expires_in) * 1000).toISOString(),
      connected_at: new Date().toISOString(),
    })
    if (error) {
      console.error('linkedin-oauth-callback: save failed', error.message)
      return back('error')
    }
  } catch (err) {
    console.error('linkedin-oauth-callback: unexpected failure', err)
    return back('error')
  }

  return back('connected')
})
