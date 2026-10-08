import { describe, expect, it } from 'vitest'
import { uploadThumbnail } from '../../../../supabase/functions/_shared/linkedinThumbnail.ts'

// The LinkedIn thumbnail upload used when posting a linked blog post,
// tested with a stand-in for site storage and LinkedIn's Images API.
const STORAGE = 'http://kong:8000'
const PUBLIC_URL = 'https://abc.supabase.co/storage/v1/object/public/post-images/org-1/pic.png'

function stand_in({ contentType = 'image/png', downloadStatus = 200, initStatus = 200, uploadStatus = 201, throwOn } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    if (throwOn && url.includes(throwOn)) throw new Error('connection reset')
    if (url.startsWith(STORAGE)) {
      return new Response(new Uint8Array([1, 2, 3]), { status: downloadStatus, headers: { 'content-type': contentType } })
    }
    if (url.includes('/rest/images?action=initializeUpload')) {
      return initStatus === 200
        ? Response.json({ value: { uploadUrl: 'https://upload.example/u/1', image: 'urn:li:image:C4E10AQF' } })
        : new Response('nope', { status: initStatus })
    }
    if (url === 'https://upload.example/u/1') return new Response(null, { status: uploadStatus })
    throw new Error(`unexpected ${url}`)
  }
  return { calls, fetchImpl }
}

function upload(fetchImpl, thumbnailUrl = PUBLIC_URL) {
  return uploadThumbnail({
    thumbnailUrl,
    storageBase: STORAGE,
    apiBase: 'https://api.example',
    apiVersion: '202601',
    accessToken: 'token-123',
    ownerUrn: 'urn:li:person:abc',
    fetchImpl,
  })
}

describe('uploadThumbnail', () => {
  it('downloads the thumbnail from site storage, registers it with LinkedIn, uploads it, and returns the image URN', async () => {
    const { calls, fetchImpl } = stand_in()
    expect(await upload(fetchImpl)).toEqual({ image: 'urn:li:image:C4E10AQF' })

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${STORAGE}/storage/v1/object/public/post-images/org-1/pic.png`,
      'POST https://api.example/rest/images?action=initializeUpload',
      'PUT https://upload.example/u/1',
    ])
    expect(JSON.parse(calls[1].body)).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:abc' } })
    expect(calls[1].headers).toMatchObject({
      Authorization: 'Bearer token-123',
      'LinkedIn-Version': '202601',
      'X-Restli-Protocol-Version': '2.0.0',
    })
    expect(calls[2].headers).toMatchObject({ Authorization: 'Bearer token-123', 'Content-Type': 'image/png' })
    expect([...calls[2].body]).toEqual([1, 2, 3])
  })

  it('always fetches through the project’s own storage, whatever host the saved address names', async () => {
    const { calls, fetchImpl } = stand_in()
    await upload(fetchImpl, 'https://some-old-host.example/storage/v1/object/public/post-images/org-1/pic.png')
    expect(calls[0].url).toBe(`${STORAGE}/storage/v1/object/public/post-images/org-1/pic.png`)
  })

  it.each([
    ['an address outside site storage', 'https://evil.example/internal/secret.png', 'not_site_storage'],
    ['a path that climbs out of the bucket', 'https://abc.supabase.co/storage/v1/object/public/post-images/../secret', 'not_site_storage'],
    ['something that isn’t a URL', 'not a url', 'not_a_url'],
  ])('fetches nothing for %s', async (_, url, reason) => {
    const { calls, fetchImpl } = stand_in()
    expect(await upload(fetchImpl, url)).toEqual({ image: null, skipped: reason })
    expect(calls).toEqual([])
  })

  it('skips a WebP picture -- LinkedIn only takes JPG, PNG and GIF -- without calling LinkedIn', async () => {
    const { calls, fetchImpl } = stand_in({ contentType: 'image/webp' })
    expect(await upload(fetchImpl)).toEqual({ image: null, skipped: 'unsupported_type: image/webp' })
    expect(calls).toHaveLength(1)
  })

  it.each([
    [{ downloadStatus: 404 }, 'download_failed: 404'],
    [{ initStatus: 403 }, 'initialize_failed: 403'],
    [{ uploadStatus: 500 }, 'upload_failed: 500'],
    [{ throwOn: 'upload.example' }, 'error: connection reset'],
  ])('gives up quietly when a step fails (%o), never throwing', async (options, reason) => {
    const { fetchImpl } = stand_in(options)
    expect(await upload(fetchImpl)).toEqual({ image: null, skipped: reason })
  })
})
