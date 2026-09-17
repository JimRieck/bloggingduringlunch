import Anthropic from 'npm:@anthropic-ai/sdk@0.32'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'

// A cheap/fast model is plenty for "read a post, suggest some titles" --
// this isn't a reasoning task.
const MODEL = 'claude-haiku-4-5-20251001'
const MAX_CONTENT_CHARS = 6000

async function suggestTitles(content: string, apiKey: string): Promise<string[]> {
  const anthropic = new Anthropic({ apiKey })

  const prompt = `You suggest titles for a blog post, for a technical blogging platform.

Post content:
${content.slice(0, MAX_CONTENT_CHARS)}

Suggest 3-5 distinct, specific titles for this post based on what it's actually about. Avoid generic/clickbait phrasing -- match the tone of a software engineer writing for other engineers.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"titles": ["...", "..."]}`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find((block) => block.type === 'text')?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no_json_in_response')

  const parsed = JSON.parse(match[0])
  const titles = Array.isArray(parsed.titles) ? parsed.titles.filter((t: unknown) => typeof t === 'string') : []
  if (titles.length === 0) throw new Error('no_titles_in_response')
  return titles
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

  let body: { content?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    return json({ error: 'invalid_body' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'not_configured' }, 500)
  }

  try {
    const titles = await suggestTitles(content, apiKey)
    return json({ titles })
  } catch {
    return json({ error: 'suggestion_failed' }, 502)
  }
})
