// The server's copy of the browser's linkedinPostTemplate
// (src/web/src/lib/socialPosting.js) -- Edge Functions can't import the
// web app's code. Used when a random schedule's planned post has been
// unpublished or deleted and the worker picks another one, so the text it
// writes looks exactly like the text the author reviewed.
// tests/lib/socialPosting.test.js checks the two stay identical.
export function linkedinPostTemplate(title: string, url: string, description: string | null = '') {
  const summary = description?.trim()
  return summary ? `${title}\n\n${summary}\n\n${url}` : `${title}\n\n${url}`
}
