import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

// Both bases are overridable so the whole OAuth + posting flow can be
// exercised against a local mock instead of the real LinkedIn.
export const OAUTH_BASE = Deno.env.get('LINKEDIN_OAUTH_BASE') ?? 'https://www.linkedin.com'
export const API_BASE = Deno.env.get('LINKEDIN_API_BASE') ?? 'https://api.linkedin.com'
// LinkedIn versions its REST API by month and retires old ones after
// roughly a year. If posting starts failing with a version error, the
// error text lands in the schedule's last_error -- bump this secret.
const API_VERSION = Deno.env.get('LINKEDIN_API_VERSION') ?? '202601'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://bloggingduringlunch.com'

export type ScheduleRow = {
  id: string
  user_id: string
  post_id: string | null
  messages: string[]
  run_count: number
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

// The Posts API's `commentary` is "little text format": these characters
// are syntax, and an unescaped one (a stray "(" or "_") silently truncates
// the post. '#' is deliberately left alone so hashtags still work.
function escapeCommentary(text: string) {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, '\\$&')
}

function plainText(html: string) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export type RunResult = { ok: boolean; error: string | null }

// Posts one occurrence of a schedule and records the outcome via
// complete_social_post_run (which also works out the next occurrence).
// Never throws -- a failure is data on the schedule, not a crashed worker.
export async function runSchedule(admin: SupabaseClient, row: ScheduleRow): Promise<RunResult> {
  const message = row.messages[row.run_count % row.messages.length]

  async function finish(ok: boolean, externalId: string | null, error: string | null, fatal = false): Promise<RunResult> {
    await admin.rpc('complete_social_post_run', {
      p_id: row.id,
      p_ok: ok,
      p_external_id: externalId,
      p_error: error,
      p_message: message,
      p_fatal: fatal,
    })
    return { ok, error }
  }

  const { data: conn } = await admin
    .from('linkedin_connections')
    .select('member_urn, access_token, expires_at')
    .eq('user_id', row.user_id)
    .maybeSingle()
  if (!conn) return finish(false, null, 'not_connected', true)
  if (new Date(conn.expires_at) <= new Date()) return finish(false, null, 'token_expired', true)

  let article: { source: string; title: string; description: string } | undefined
  if (row.post_id) {
    const { data: post } = await admin
      .from('posts')
      .select('title, slug, content, status, organizations(slug)')
      .eq('id', row.post_id)
      .maybeSingle()
    const org = Array.isArray(post?.organizations) ? post?.organizations[0] : post?.organizations
    if (!post || post.status !== 'published' || !org?.slug) {
      return finish(false, null, 'post_not_published')
    }
    article = {
      source: `${APP_URL}/blog/${org.slug}/${post.slug}`,
      title: post.title,
      description: plainText(post.content ?? '').slice(0, 200),
    }
  }

  const payload = {
    author: conn.member_urn,
    commentary: escapeCommentary(message),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
    ...(article ? { content: { article } } : {}),
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}/rest/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'LinkedIn-Version': API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    return finish(false, null, `network_error: ${(err as Error).message}`)
  }

  if (res.status === 201) {
    return finish(true, res.headers.get('x-restli-id'), null)
  }
  const detail = (await res.text().catch(() => '')).slice(0, 500)
  // 401/403 mean the token is revoked/expired or the app lost its scope --
  // retrying on the next occurrence can't help until the user reconnects.
  const fatal = res.status === 401 || res.status === 403
  return finish(false, null, `linkedin_${res.status}: ${detail}`, fatal)
}
