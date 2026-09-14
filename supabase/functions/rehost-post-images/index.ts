import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const MAX_URLS = 30
const MAX_BYTES = 5 * 1024 * 1024 // matches the post-images bucket's own file_size_limit

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// Not exhaustive DNS-rebinding-proof SSRF protection -- a lightweight
// hostname check proportionate to this being an authenticated-editor-only
// action (not a public endpoint), not a fully hardened URL fetcher.
const PRIVATE_HOSTNAME = /^(localhost|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1\]?)/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isFetchableImageUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (PRIVATE_HOSTNAME.test(url.hostname)) return null
  return url
}

async function rehostOne(
  url: string,
  organizationId: string,
  callerId: string,
  adminClient: ReturnType<typeof createClient>,
): Promise<string | null> {
  const parsed = isFetchableImageUrl(url)
  if (!parsed) return null

  const response = await fetch(parsed)
  if (!response.ok) return null

  const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? ''
  const ext = ALLOWED_TYPES[contentType]
  if (!ext) return null

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) return null

  const path = `${organizationId}/${crypto.randomUUID()}.${ext}`
  const { error: uploadError } = await adminClient.storage
    .from('post-images')
    .upload(path, bytes, { contentType })
  if (uploadError) return null

  const {
    data: { publicUrl },
  } = adminClient.storage.from('post-images').getPublicUrl(path)

  const { error: insertError } = await adminClient.from('post_images').insert({
    organization_id: organizationId,
    uploaded_by: callerId,
    url: publicUrl,
    storage_path: path,
  })
  if (insertError) return null

  return publicUrl
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  let imageUrls: unknown
  try {
    ;({ imageUrls } = await req.json())
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  if (!Array.isArray(imageUrls) || !imageUrls.every((u) => typeof u === 'string')) {
    return json({ error: 'invalid_body' }, 400)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Identify the caller from their own JWT -- never trust anything the
  // client claims about who they are or which org they belong to.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
  } = await callerClient.auth.getUser()
  if (!caller) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Service-role client for the privileged lookup/upload -- bypasses RLS
  // intentionally, since this whole function is an editor-only action
  // already gated by the verified caller identity above.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: membership } = await adminClient
    .from('memberships')
    .select('organization_id')
    .eq('user_id', caller.id)
    .in('role', ['owner', 'editor'])
    .limit(1)
    .maybeSingle()
  if (!membership) {
    return json({ error: 'not_an_editor' }, 403)
  }
  const organizationId = membership.organization_id as string

  const uniqueUrls = [...new Set(imageUrls)].slice(0, MAX_URLS)

  const results = await Promise.allSettled(
    uniqueUrls.map((url) => rehostOne(url, organizationId, caller.id, adminClient)),
  )

  const urlMap: Record<string, string> = {}
  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      urlMap[uniqueUrls[i]] = result.value
    }
  })

  return json({ urlMap })
})
