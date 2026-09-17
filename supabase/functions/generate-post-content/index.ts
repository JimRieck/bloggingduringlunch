import Anthropic from 'npm:@anthropic-ai/sdk@0.32'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'

// Writing a coherent draft is a genuinely different kind of task than
// the short-label classification the other two functions in this repo
// do (suggest-tags-and-categories, suggest-post-titles) -- worth a more
// capable model, not just the cheapest one that'll return valid JSON.
const MODEL = 'claude-sonnet-5'
const MAX_DESCRIPTION_CHARS = 2000

// Returns a plain HTML fragment (not JSON) -- asking a model to escape
// prose correctly inside a JSON string is more failure-prone than
// asking for the HTML directly and defensively stripping a stray
// markdown code fence if it adds one anyway. Tiptap's StarterKit schema
// (paragraph/heading/list/blockquote/code, the marks) parses this
// directly via editor.commands.setContent -- the same tags the prompt
// is restricted to below.
async function generateContent(description: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey })

  const prompt = `You write blog post drafts for a technical blogging platform, for a software engineer writing about their own work.

Description of what this post should be about:
${description.slice(0, MAX_DESCRIPTION_CHARS)}

Write a complete draft blog post body based on this description: a clear opening, a few developed paragraphs, in a straightforward first-person engineering voice -- not marketing copy, not filler. Use only these HTML tags, and no others: <p>, <h2>, <h3>, <ul>, <ol>, <li>, <blockquote>, <strong>, <em>, <code>, <pre>.

Respond with ONLY the HTML body content -- no markdown code fences, no commentary, no <html>/<body> wrapper tags, starting directly with a <p> or <h2> tag.`

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find((block) => block.type === 'text')?.text ?? ''
  const cleaned = text
    .trim()
    .replace(/^```(?:html)?\n?/, '')
    .replace(/```$/, '')
    .trim()
  if (!cleaned) throw new Error('empty_response')
  return cleaned
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

  let body: { description?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) {
    return json({ error: 'invalid_body' }, 400)
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return json({ error: 'not_configured' }, 500)
  }

  try {
    const content = await generateContent(description, apiKey)
    return json({ content })
  } catch {
    return json({ error: 'generation_failed' }, 502)
  }
})
