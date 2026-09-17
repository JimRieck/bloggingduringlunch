import { createClient } from 'jsr:@supabase/supabase-js@2'

// Verifies the request carries a real logged-in user's own JWT, via a
// forwarded Authorization header -- shared by every Edge Function that
// only needs "is this a real logged-in caller," not a specific
// org/editor role (a function that needs a role check, like
// rehost-post-images, still does that check itself with a service-role
// client afterward -- this only answers "who is calling").
export async function getCaller(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return null

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
  } = await callerClient.auth.getUser()
  return user
}
