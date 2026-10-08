// Uploads a blog post's thumbnail to LinkedIn so a post's link card
// shows the picture. LinkedIn's Posts API doesn't fetch a link to build
// its preview -- the card only gets an image if one is uploaded through
// the Images API and its URN set as the article's thumbnail.
//
// Only fetches images from this site's own storage (the post-images
// bucket), always through the project's own Supabase URL -- never
// whatever address happens to be in thumbnail_url -- so a post can't
// point the server at an arbitrary URL. LinkedIn accepts JPG, PNG and
// GIF; anything else (e.g. WebP) is skipped.
//
// Never throws: a missing picture shouldn't stop the post. Free of
// Deno-only APIs so the web app's Vitest suite can unit-test it.
const STORAGE_PATH = '/storage/v1/object/public/post-images/'
const LINKEDIN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif']

type Options = {
  thumbnailUrl: string
  storageBase: string
  apiBase: string
  apiVersion: string
  accessToken: string
  ownerUrn: string
  fetchImpl?: typeof fetch
}

export type ThumbnailResult = { image: string } | { image: null; skipped: string }

export async function uploadThumbnail({
  thumbnailUrl,
  storageBase,
  apiBase,
  apiVersion,
  accessToken,
  ownerUrn,
  fetchImpl = fetch,
}: Options): Promise<ThumbnailResult> {
  try {
    let path: string
    try {
      path = new URL(thumbnailUrl).pathname
    } catch {
      return { image: null, skipped: 'not_a_url' }
    }
    if (!path.startsWith(STORAGE_PATH) || path.includes('..')) return { image: null, skipped: 'not_site_storage' }

    const download = await fetchImpl(`${storageBase}${path}`)
    if (!download.ok) return { image: null, skipped: `download_failed: ${download.status}` }
    const type = (download.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!LINKEDIN_IMAGE_TYPES.includes(type)) return { image: null, skipped: `unsupported_type: ${type || 'unknown'}` }
    const bytes = new Uint8Array(await download.arrayBuffer())

    const init = await fetchImpl(`${apiBase}/rest/images?action=initializeUpload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': apiVersion,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    })
    if (!init.ok) return { image: null, skipped: `initialize_failed: ${init.status}` }
    const { value } = await init.json()
    if (!value?.uploadUrl || !value?.image) return { image: null, skipped: 'initialize_failed: bad response' }

    const upload = await fetchImpl(value.uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': type },
      body: bytes,
    })
    if (!upload.ok) return { image: null, skipped: `upload_failed: ${upload.status}` }

    return { image: value.image }
  } catch (err) {
    return { image: null, skipped: `error: ${(err as Error).message}` }
  }
}
