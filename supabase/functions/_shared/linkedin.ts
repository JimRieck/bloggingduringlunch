import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { uploadThumbnail } from './linkedinThumbnail.ts'

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

  let article: { source: string; title: string; description: string; thumbnail?: string } | undefined
  if (row.post_id) {
    const { data: post } = await admin
      .from('posts')
      .select('title, slug, content, status, thumbnail_url, organizations(slug)')
      .eq('id', row.post_id)
      .maybeSingle()
    const org = Array.isArray(post?.organizations) ? post?.organizations[0] : post?.organizations
    if (!post || post.status !== 'published' || !org?.slug) {
      return finish(false, null, 'post_not_published')
    }
    article = {
      // Tagged so a click from LinkedIn counts as LinkedIn in the admin
      // traffic sources, even when LinkedIn's app hides the referrer.
      source: `${APP_URL}/blog/${org.slug}/${post.slug}?utm_source=linkedin`,
      title: post.title,
      description: plainText(post.content ?? '').slice(0, 200),
    }
    // The card's picture: LinkedIn doesn't fetch the link itself, so
    // without an uploaded thumbnail the card is title-only.
    if (post.thumbnail_url) {
      const thumbnail = await uploadThumbnail({
        thumbnailUrl: post.thumbnail_url,
        storageBase: Deno.env.get('SUPABASE_URL')!,
        apiBase: API_BASE,
        apiVersion: API_VERSION,
        accessToken: conn.access_token,
        ownerUrn: conn.member_urn,
      })
      if (thumbnail.image) article.thumbnail = thumbnail.image
      else console.warn(`runSchedule ${row.id}: posting without a thumbnail (${thumbnail.skipped})`)
    }
  }

  const buildPayload = (withThumbnail: boolean) => {
    const content = article && !withThumbnail ? { ...article, thumbnail: undefined } : article
    return {
      author: conn.member_urn,
      commentary: escapeCommentary(message),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(content ? { content: { article: content } } : {}),
    }
  }
  const createPost = (withThumbnail: boolean) =>
    fetch(`${API_BASE}/rest/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'LinkedIn-Version': API_VERSION,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildPayload(withThumbnail)),
    })

  let res: Response
  try {
    res = await createPost(true)
    // If LinkedIn rejects the post and it had a freshly uploaded picture
    // (e.g. the image is still processing), try once more without it --
    // a post without a picture beats no post. Not for 401/403, which no
    // retry can fix.
    if (article?.thumbnail && res.status !== 201 && res.status !== 401 && res.status !== 403) {
      const firstError = (await res.text().catch(() => '')).slice(0, 300)
      console.warn(`runSchedule ${row.id}: post with thumbnail failed (${res.status} ${firstError}); retrying without`)
      res = await createPost(false)
    }
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
