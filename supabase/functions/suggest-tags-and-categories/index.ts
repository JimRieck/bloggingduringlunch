import Anthropic from 'npm:@anthropic-ai/sdk@0.32'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'

// A cheap/fast model is plenty for "read a post, suggest some tags" --
// this isn't a reasoning task, and it may run once per post across a
// whole backlog in the bulk-tag flow.
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_CONTENT_CHARS = 4000

// Suggestion-only -- this function never touches the database. Creating
// the actual category/tag rows and attaching them to a post happens
// client-side afterward (src/web/src/lib/taxonomy.js), through the same
// RLS-protected insert calls a manual "+ Add New Category" or typed tag
// already goes through. That keeps this function simple (no
// service-role client needed) and means the write is always subject to
// the same authorization the UI already enforces.
async function suggest(
  title: string,
  content: string,
  existingCategories: string[],
  existingTags: string[],
  apiKey: string,
): Promise<{ categories: string[]; tags: string[] }> {
  const anthropic = new Anthropic({ apiKey })

  // Deduped -- a caller passing a raw (possibly duplicated) list would
  // otherwise make a repeated name look artificially prominent/"safe"
  // to the model, biasing it toward suggesting that name regardless of
  // whether it actually fits this specific post.
  const uniqueCategories = [...new Set(existingCategories)]
  const uniqueTags = [...new Set(existingTags)]

  const prompt = `You suggest categories and tags for a blog post, for a technical blogging platform.

Post title: ${title}

Post content:
${content.slice(0, MAX_CONTENT_CHARS)}

This blog's existing categories: ${uniqueCategories.length ? uniqueCategories.join(', ') : '(none yet)'}
This author's existing tags: ${uniqueTags.length ? uniqueTags.join(', ') : '(none yet)'}

Suggest 1-2 categories (broad topic areas) and 3-6 tags (more specific keywords), based specifically on what THIS post is actually about -- not on which existing category shows up most often or seems like a safe default. Only reuse an existing category/tag name when it's a genuine, specific match for this post's content; propose a new, more precise one instead of forcing a loose fit.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"categories": ["..."], "tags": ["..."]}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find((block) => block.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no_json_in_response')

  const parsed = JSON.parse(match[0])
  const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((c: unknown) => typeof c === 'string') : []
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t: unknown) => typeof t === 'string') : []
  return { categories, tags }
}

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

  let body: { title?: unknown; content?: unknown; existingCategories?: unknown; existingTags?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title : ''
  const content = typeof body.content === 'string' ? body.content : ''
  const existingCategories = Array.isArray(body.existingCategories) ? body.existingCategories.filter((c) => typeof c === 'string') : []
  const existingTags = Array.isArray(body.existingTags) ? body.existingTags.filter((t) => typeof t === 'string') : []
  if (!title && !content) {
    return json({ error: 'invalid_body' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'not_configured' }, 500)
  }

  try {
    const result = await suggest(title, content, existingCategories, existingTags, apiKey)
    return json(result)
  } catch {
    return json({ error: 'suggestion_failed' }, 502)
  }
})
