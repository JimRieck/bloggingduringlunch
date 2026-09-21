import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { getFeatureFlags } from '../_shared/featureFlags.ts'
import { OAUTH_BASE, serviceClient } from '../_shared/linkedin.ts'

// Step 1 of connecting LinkedIn: hand the browser a one-time authorize
// URL. The `state` nonce is bound to this user server-side so the
// callback (which arrives as a bare browser redirect, with no login of
// its own) can tell who the connection belongs to -- and can't be forged.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const caller = await getCaller(req)
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  const { linkedin_posting: enabled } = await getFeatureFlags(['linkedin_posting'])
  if (!enabled) {
    return json({ error: 'feature_disabled' }, 403)
  }

  const clientId = Deno.env.get('LINKEDIN_CLIENT_ID')
  const redirectUri = Deno.env.get('LINKEDIN_REDIRECT_URI')
  if (!clientId || !redirectUri) {
    return json({ error: 'not_configured' }, 500)
  }

  const admin = serviceClient()
  // Abandoned attempts shouldn't accumulate forever.
  await admin.from('linkedin_oauth_states').delete().lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())

  const state = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const { error } = await admin.from('linkedin_oauth_states').insert({ state, user_id: caller.id })
  if (error) {
    return json({ error: 'state_failed' }, 500)
  }

  const url = new URL(`${OAUTH_BASE}/oauth/v2/authorization`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  // openid+profile identify the member; w_member_social is the permission
  // to post on their behalf ("Share on LinkedIn" product).
  url.searchParams.set('scope', 'openid profile w_member_social')

  return json({ url: url.toString() })
})
