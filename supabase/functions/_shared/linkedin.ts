import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { uploadThumbnail } from './linkedinThumbnail.ts'
import { linkedinPostTemplate } from './linkedinTemplate.ts'

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
  recurrence?: string
  next_run_at?: string | null
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

// The public address of a blog post, tagged so a click from LinkedIn
// counts as LinkedIn in the admin traffic sources, even when LinkedIn's
// app hides the referrer.
function blogPostUrl(orgSlug: string, postSlug: string) {
  return `${APP_URL}/blog/${orgSlug}/${postSlug}?utm_source=linkedin`
}

function orgSlugOf(post: { organizations?: unknown }) {
  const org = Array.isArray(post.organizations) ? post.organizations[0] : post.organizations
  return (org as { slug?: string } | null | undefined)?.slug ?? null
}

// What this run posts: its text and the blog post it links (if any).
// Ordinary schedules take turns through their variations. A random
// schedule posts the slot that's due -- the text and post the author
// reviewed -- unless that post has since been unpublished or deleted, in
// which case it picks another of the author's published posts at random
// (with the same title/description/link text) rather than fail.
async function contentFor(
  admin: SupabaseClient,
  row: ScheduleRow,
): Promise<{ message: string; postId: string | null } | { error: string }> {
  if (row.recurrence !== 'random') {
    return { message: row.messages[row.run_count % row.messages.length], postId: row.post_id }
  }

  const { data: slot } = await admin
    .from('scheduled_social_post_slots')
    .select('post_id, message')
    .eq('schedule_id', row.id)
    .eq('run_at', row.next_run_at)
    .maybeSingle()
  if (!slot) return { error: 'slot_missing' }

  if (slot.post_id) {
    const { data: planned } = await admin.from('posts').select('status').eq('id', slot.post_id).maybeSingle()
    if (planned?.status === 'published') return { message: slot.message, postId: slot.post_id }
  }

  const { data: candidates } = await admin
    .from('posts')
    .select('id, title, slug, description, organizations(slug)')
    .eq('author_id', row.user_id)
    .eq('status', 'published')
  const usable = (candidates ?? []).filter((p) => orgSlugOf(p))
  if (usable.length === 0) return { error: 'post_not_published' }
  const pick = usable[Math.floor(Math.random() * usable.length)]
  return {
    message: linkedinPostTemplate(pick.title, blogPostUrl(orgSlugOf(pick)!, pick.slug), pick.description),
    postId: pick.id,
  }
}

// Posts one occurrence of a schedule and records the outcome via
// complete_social_post_run (which also works out the next occurrence).
// Never throws -- a failure is data on the schedule, not a crashed worker.
export async function runSchedule(admin: SupabaseClient, row: ScheduleRow): Promise<RunResult> {
  let message = ''

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

  const content = await contentFor(admin, row)
  if ('error' in content) return finish(false, null, content.error)
  message = content.message

  let article: { source: string; title: string; description: string; thumbnail?: string } | undefined
  if (content.postId) {
    const { data: post } = await admin
      .from('posts')
      .select('title, slug, description, content, status, thumbnail_url, organizations(slug)')
      .eq('id', content.postId)
      .maybeSingle()
    const orgSlug = post ? orgSlugOf(post) : null
    if (!post || post.status !== 'published' || !orgSlug) {
      return finish(false, null, 'post_not_published')
    }
    article = {
      source: blogPostUrl(orgSlug, post.slug),
      title: post.title,
      // The author's own description when there is one; otherwise the
      // start of the post itself.
      description: post.description?.trim() || plainText(post.content ?? '').slice(0, 200),
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
