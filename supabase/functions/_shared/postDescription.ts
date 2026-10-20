// The pieces of suggest-post-description that don't need Deno or the
// network, kept here so they can be tested directly (see
// src/web/tests/lib/postDescription.test.js).

// Matches the posts.description check in 20261020100000_post_description.sql.
export const DESCRIPTION_MAX = 150
const MAX_CONTENT_CHARS = 6000

export function descriptionPrompt(title: string, content: string) {
  return `You write the short description for a blog post on a technical blogging platform. It is shown when the post is shared -- on LinkedIn and in link previews -- right under the title.

Title: ${title || '(none yet)'}

Post content:
${content.slice(0, MAX_CONTENT_CHARS)}

Write one or two plain sentences, at most ${DESCRIPTION_MAX - 20} characters, saying what a reader gets from this post. Don't repeat the title, no hashtags, no emoji, no quotes, no clickbait -- match the tone of a software engineer writing for other engineers.

Respond with ONLY the description text, nothing else.`
}

// The model's answer, made fit for the description field: one line, no
// wrapping quotes, and never over the limit (cut at a word, with "…").
export function cleanDescription(raw: string) {
  let text = raw.replace(/\s+/g, ' ').trim()
  text = text.replace(/^(description:\s*)/i, '')
  text = text.replace(/^["“'](.*)["”']$/, '$1').trim()
  if (text.length <= DESCRIPTION_MAX) return text
  const cut = text.slice(0, DESCRIPTION_MAX - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > DESCRIPTION_MAX / 2 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, '')}…`
}
