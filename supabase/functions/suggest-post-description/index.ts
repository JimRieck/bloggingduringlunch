import Anthropic from 'npm:@anthropic-ai/sdk@0.32'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'
import { getFeatureFlags } from '../_shared/featureFlags.ts'
import { recordAiUsage } from '../_shared/aiUsage.ts'
import { cleanDescription, descriptionPrompt } from '../_shared/postDescription.ts'

// Same cheap/fast model as suggest-post-titles -- a sentence or two
// about a post isn't a reasoning task.
const MODEL = 'claude-haiku-4-5-20251001'

async function suggestDescription(title: string, content: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: descriptionPrompt(title, content) }],
  })
  const text = message.content.find((block) => block.type === 'text')?.text ?? ''
  const description = cleanDescription(text)
  if (!description) throw new Error('no_description_in_response')
  return description
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

  const { ai_description_generation: enabled } = await getFeatureFlags(['ai_description_generation'])
  if (!enabled) {
    return json({ error: 'feature_disabled' }, 403)
  }

  let body: { title?: unknown; content?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) {
    return json({ error: 'invalid_body' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    await recordAiUsage(caller.id, 'description', 'not_configured')
    return json({ error: 'not_configured' }, 500)
  }

  let description: string
  try {
    description = await suggestDescription(title, content, apiKey)
  } catch {
    await recordAiUsage(caller.id, 'description', 'suggestion_failed')
    return json({ error: 'suggestion_failed' }, 502)
  }
  await recordAiUsage(caller.id, 'description')
  return json({ description })
})
