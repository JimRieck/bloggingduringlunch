import { createClient } from 'jsr:@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk@0.32'
import OpenAI from 'npm:openai@4'
import { corsHeaders } from '../_shared/cors.ts'
import { json } from '../_shared/response.ts'
import { getCaller } from '../_shared/auth.ts'

// Cheap/fast text model for the first hop (deriving an image prompt);
// image generation itself has no Anthropic equivalent, hence OpenAI for
// the second hop.
const TEXT_MODEL = 'claude-haiku-4-5-20251001'
const IMAGE_MODEL = 'gpt-image-1'
const MAX_CONTENT_CHARS = 4000

// Raw article text isn't a usable image prompt on its own -- this turns
// it into a short, concrete visual description first.
async function describeImage(title: string, content: string, apiKey: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey })

  const prompt = `You write concise visual descriptions for an AI image generator, to illustrate a technical blog post as a clean editorial-style hero image.

Post title: ${title}

Post content:
${content.slice(0, MAX_CONTENT_CHARS)}

Write ONE concise visual description (2-3 sentences) for a hero image that captures what this post is about, in a clean, modern editorial-illustration style. Do not describe any text, words, letters, or writing appearing in the image -- image generators render text poorly and it always comes out garbled. Respond with ONLY the description, no other commentary.`

  const message = await anthropic.messages.create({
    model: TEXT_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content.find((block) => block.type === 'text')?.text ?? ''
  const description = text.trim()
  if (!description) throw new Error('empty_description')
  return description
}

async function generateImage(description: string, apiKey: string): Promise<Uint8Array> {
  const openai = new OpenAI({ apiKey })

  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt: description,
    size: '1536x1024',
    n: 1,
  })

  const b64 = result.data?.[0]?.b64_json
  if (!b64) throw new Error('no_image_in_response')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  const caller = await getCaller(req)
  if (!caller || !authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: { organizationId?: unknown; title?: unknown; content?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : ''
  const title = typeof body.title === 'string' ? body.title : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!organizationId || (!title && !content)) {
    return json({ error: 'invalid_body' }, 400)
  }

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!anthropicKey || !openaiKey) {
    return json({ error: 'not_configured' }, 500)
  }

  let imageBytes: Uint8Array
  try {
    const description = await describeImage(title, content, anthropicKey)
    imageBytes = await generateImage(description, openaiKey)
  } catch {
    return json({ error: 'generation_failed' }, 502)
  }

  // Caller-scoped client, not service-role -- the existing post_images/
  // storage RLS (is_org_editor(organization_id) and, on post_images,
  // uploaded_by = auth.uid()) is exactly the check this write needs, so
  // there's no reason to bypass it the way rehost-post-images does (that
  // function needs service-role for other reasons this one doesn't
  // share). A caller who isn't actually an editor of organizationId gets
  // rejected by RLS here, same as a manual upload attempt would be.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const path = `${organizationId}/${crypto.randomUUID()}.png`
  const { error: uploadError } = await callerClient.storage
    .from('post-images')
    .upload(path, imageBytes, { contentType: 'image/png' })
  if (uploadError) {
    return json({ error: 'upload_failed' }, 502)
  }

  const {
    data: { publicUrl },
  } = callerClient.storage.from('post-images').getPublicUrl(path)

  const { error: insertError } = await callerClient.from('post_images').insert({
    organization_id: organizationId,
    uploaded_by: caller.id,
    url: publicUrl,
    storage_path: path,
  })
  if (insertError) {
    return json({ error: 'upload_failed' }, 502)
  }

  return json({ url: publicUrl })
})
