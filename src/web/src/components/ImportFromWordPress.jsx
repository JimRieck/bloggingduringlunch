import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabaseClient.js'
import { resolveCategoryIds, resolveTagIds } from '../lib/taxonomy.js'
import { CircularProgress } from './CircularProgress.jsx'
import './ImportFromWordPress.css'

const PAGE_SIZE = 20

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function extractImageUrls(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.querySelectorAll('img[src]')].map((img) => img.getAttribute('src'))
}

// Some posts' image URLs point at this app's own current domain instead
// of the WordPress.com site (e.g. bloggingduringlunch.com used to be
// mapped to the WordPress site as a custom domain, before it was
// repointed here) -- that domain now 404s (or serves this app's own SPA
// shell) for a /wp-content/uploads/ path instead of the real image, even
// though the same file is still reachable under the WordPress.com site
// itself. Since every such image legitimately belongs to the site being
// imported from, normalize its hostname to that site before fetching.
function normalizeWpImageUrl(url, site) {
  if (!site) return url
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== site && parsed.pathname.startsWith('/wp-content/uploads/')) {
      parsed.protocol = 'https:'
      parsed.hostname = site
      return parsed.toString()
    }
  } catch {
    // not an absolute URL -- leave it alone
  }
  return url
}

// WordPress.com's API sometimes hands back a stray empty heading block
// (e.g. `<h1 class="wp-block-heading"></h1>`) ahead of the real body --
// the post's title is already stored separately in `posts.title`, so an
// empty heading here is just noise, not lost content. Also rewrites any
// `<img src>` found in `urlMap` to point at this app's own rehosted copy
// instead of the original (soon-to-be-deprecated) WordPress.com URL --
// and, since WordPress wraps most inline images in `<a href>` (a
// lightbox link to the image's own WordPress attachment page) and sets
// a `srcset` with several more WordPress.com-hosted size variants, both
// of those get rewritten/dropped too, or the image would still leak the
// old site even after its own `src` was successfully rehosted.
function rewriteImportedContent(html, urlMap, site) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    if (!el.textContent.trim()) el.remove()
  })
  doc.querySelectorAll('img[src]').forEach((img) => {
    const rehosted = urlMap[normalizeWpImageUrl(img.getAttribute('src'), site)]
    if (!rehosted) return
    img.setAttribute('src', rehosted)
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
    const link = img.closest('a')
    if (link) link.setAttribute('href', rehosted)
  })
  return doc.body.innerHTML
}

// WordPress.com's API returns titles as HTML-entity-encoded plain text
// (e.g. "&#8220;...&#8221;" for curly quotes) rather than decoded text or
// real markup, so displaying/storing it verbatim leaves literal entity
// codes on screen.
function decodeHtmlEntities(text) {
  const el = document.createElement('textarea')
  el.innerHTML = text
  return el.value
}

function normalizeSite(input) {
  return input
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
}

export function ImportFromWordPress({ session }) {
  const [membership, setMembership] = useState(undefined)
  const [siteInput, setSiteInput] = useState('')
  const [fetchedSite, setFetchedSite] = useState('')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [posts, setPosts] = useState(null)
  const [found, setFound] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [importedIds, setImportedIds] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(null)
  const [importError, setImportError] = useState('')
  const [importNotice, setImportNotice] = useState('')

  const [orgCategories, setOrgCategories] = useState([])
  const [authorTags, setAuthorTags] = useState([])

  useEffect(() => {
    supabase
      .from('memberships')
      .select('role, organizations(id, name)')
      .eq('user_id', session.user.id)
      .in('role', ['owner', 'editor'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setMembership(data ?? null))
  }, [session.user.id])

  useEffect(() => {
    supabase
      .from('tags')
      .select('id, name')
      .eq('author_id', session.user.id)
      .then(({ data }) => setAuthorTags(data ?? []))
  }, [session.user.id])

  useEffect(() => {
    if (!membership?.organizations?.id) return
    supabase
      .from('categories')
      .select('id, name')
      .eq('organization_id', membership.organizations.id)
      .then(({ data }) => setOrgCategories(data ?? []))
  }, [membership?.organizations?.id])

  async function fetchPage(site, pageNum, append) {
    setFetching(true)
    setFetchError('')
    try {
      const url = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}/posts/?number=${PAGE_SIZE}&page=${pageNum}&fields=ID,title,date,excerpt,content,featured_image,categories,tags`
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`That site couldn't be reached (${response.status}). Check the address and try again.`)
      }
      const data = await response.json()
      if (data.error) {
        throw new Error('That WordPress.com site could not be found.')
      }
      const decodedPosts = data.posts.map((p) => ({ ...p, title: decodeHtmlEntities(p.title || '') }))
      setPosts((current) => (append ? [...(current ?? []), ...decodedPosts] : decodedPosts))
      setFound(data.found ?? data.posts.length)
      setPage(pageNum)
    } catch (err) {
      setFetchError(err.message || 'Could not fetch posts from that site.')
      if (!append) setPosts(null)
    } finally {
      setFetching(false)
    }
  }

  function handleFetch(e) {
    e.preventDefault()
    const site = normalizeSite(siteInput)
    if (!site) {
      setFetchError('Enter a WordPress.com site, e.g. yourblog.wordpress.com.')
      return
    }
    setSelectedIds(new Set())
    setImportedIds(new Set())
    setImportNotice('')
    setFetchedSite(site)
    fetchPage(site, 1, false)
  }

  function handleLoadMore() {
    fetchPage(normalizeSite(siteInput), page + 1, true)
  }

  function toggleSelected(id) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableIds = (posts ?? []).map((p) => p.ID).filter((id) => !importedIds.has(id))
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))

  function toggleSelectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds))
  }

  // One rehost-post-images call per post (not one for the whole batch) --
  // Edge Functions get a ~2s CPU-time budget per invocation, and bundling
  // every selected post's images into a single call risked tripping that
  // and silently dropping some images. Per-post calls also make a real
  // "N of M" progress readout possible.
  async function handleImport() {
    const organizationId = membership.organizations.id
    const toImport = (posts ?? []).filter((p) => selectedIds.has(p.ID))
    if (toImport.length === 0) return

    setImporting(true)
    setImportError('')
    setImportNotice('')
    setImportProgress({ done: 0, total: toImport.length })

    const importedThisRun = []
    let failedPostCount = 0
    let skippedImageCount = 0

    // Local, mutable copies -- resolveCategoryIds/resolveTagIds append a
    // newly-created row to whichever list they're given, so a category
    // or tag invented for post #1 in this loop is reused (not
    // recreated) for post #5 if it shows up again, without waiting on a
    // state update between iterations.
    const orgCategoriesCopy = [...orgCategories]
    const authorTagsCopy = [...authorTags]

    for (const p of toImport) {
      const imageUrls = [
        ...new Set([
          ...(p.featured_image ? [normalizeWpImageUrl(p.featured_image, fetchedSite)] : []),
          ...extractImageUrls(p.content || '').map((u) => normalizeWpImageUrl(u, fetchedSite)),
        ]),
      ]

      let urlMap = {}
      if (imageUrls.length > 0) {
        const { data, error: rehostError } = await supabase.functions.invoke('rehost-post-images', {
          body: { imageUrls },
        })
        if (!rehostError) urlMap = data?.urlMap ?? {}
      }
      skippedImageCount += imageUrls.filter((u) => !urlMap[u]).length

      const { data: insertedPost, error } = await supabase
        .from('posts')
        .insert({
          organization_id: organizationId,
          author_id: session.user.id,
          title: p.title?.trim() || 'Untitled',
          content: DOMPurify.sanitize(rewriteImportedContent(p.content || '', urlMap, fetchedSite)),
          thumbnail_url: p.featured_image
            ? (urlMap[normalizeWpImageUrl(p.featured_image, fetchedSite)] ?? null)
            : null,
          status: 'draft',
          // Drafts have no published_at yet, so MyPosts.jsx falls back to
          // created_at for the date it shows -- defaulting that to "now"
          // would make every imported post look like it was written today
          // instead of on its original WordPress date.
          created_at: p.date,
        })
        .select('id')
        .single()

      if (error) {
        failedPostCount += 1
      } else {
        importedThisRun.push(p.ID)

        // WordPress.com's API returns categories/tags as objects keyed
        // by name (already resolved, not bare numeric ids) -- confirmed
        // directly against the live API before relying on this shape.
        const categoryNames = Object.values(p.categories ?? {}).map((c) => c.name)
        const tagNames = Object.values(p.tags ?? {}).map((t) => t.name)

        if (categoryNames.length > 0) {
          const categoryIds = await resolveCategoryIds(categoryNames, organizationId, orgCategoriesCopy)
          if (categoryIds.length > 0) {
            await supabase
              .from('post_categories')
              .insert(categoryIds.map((category_id) => ({ post_id: insertedPost.id, category_id })))
          }
        }
        if (tagNames.length > 0) {
          const tagIds = await resolveTagIds(tagNames, session.user.id, authorTagsCopy)
          if (tagIds.length > 0) {
            await supabase.from('post_tags').insert(tagIds.map((tag_id) => ({ post_id: insertedPost.id, tag_id })))
          }
        }
      }
      setImportProgress((prog) => ({ done: (prog?.done ?? 0) + 1, total: toImport.length }))
    }

    setOrgCategories(orgCategoriesCopy)
    setAuthorTags(authorTagsCopy)
    setImporting(false)
    setImportProgress(null)

    setImportedIds((current) => {
      const next = new Set(current)
      importedThisRun.forEach((id) => next.add(id))
      return next
    })
    setSelectedIds((current) => {
      const next = new Set(current)
      importedThisRun.forEach((id) => next.delete(id))
      return next
    })

    if (importedThisRun.length === 0) {
      setImportError("Couldn't import the selected post(s). Try again.")
      return
    }

    const notes = []
    if (failedPostCount > 0) {
      notes.push(`${failedPostCount} post${failedPostCount === 1 ? '' : 's'} couldn't be imported.`)
    }
    if (skippedImageCount > 0) {
      notes.push(
        `${skippedImageCount} image${skippedImageCount === 1 ? '' : 's'} couldn't be copied over and still point${skippedImageCount === 1 ? 's' : ''} at the original site.`,
      )
    }
    setImportNotice(
      `Imported ${importedThisRun.length} post${importedThisRun.length === 1 ? '' : 's'} as draft${importedThisRun.length === 1 ? '' : 's'}. Review and publish from My posts.${notes.length ? ' ' + notes.join(' ') : ''}`,
    )
  }

  if (membership === undefined) {
    return <p className="post-form-status">Loading…</p>
  }
  if (membership === null) {
    return <p className="post-form-status">You need to be an owner or editor on a blog to import posts.</p>
  }

  return (
    <div id="import-wordpress">
      <h2>Import from WordPress — {membership.organizations.name}</h2>
      <p className="import-intro">
        Pull posts in from a WordPress.com-hosted blog and choose exactly which ones to bring
        over. Imported posts land as drafts so you can review them before publishing.
      </p>

      <form className="import-source-form" onSubmit={handleFetch}>
        <label className="field">
          <span>WordPress.com site</span>
          <input
            type="text"
            value={siteInput}
            onChange={(e) => setSiteInput(e.target.value)}
            placeholder="yourblog.wordpress.com"
          />
        </label>
        <button type="submit" className="primary" disabled={fetching}>
          {fetching && posts === null ? 'Fetching…' : 'Fetch posts'}
        </button>
      </form>

      {fetchError && (
        <p className="field-error" role="alert">
          {fetchError}
        </p>
      )}
      {importError && (
        <p className="field-error" role="alert">
          {importError}
        </p>
      )}
      {importNotice && (
        <p className="auth-notice" role="status">
          {importNotice}
        </p>
      )}

      {posts && (
        <>
          <div className="import-list-header">
            <label className="import-select-all">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={selectableIds.length === 0}
              />
              <span>Select all</span>
            </label>
            <span className="import-count">
              {posts.length} of {found} loaded
            </span>
            <button
              type="button"
              className="primary"
              disabled={selectedIds.size === 0 || importing}
              onClick={handleImport}
            >
              {importing ? (
                <span className="import-progress">
                  <CircularProgress value={importProgress?.done ?? 0} max={importProgress?.total ?? 1} />
                  {importProgress ? `${importProgress.done} of ${importProgress.total}` : 'Importing…'}
                </span>
              ) : (
                `Import ${selectedIds.size || ''} selected`
              )}
            </button>
          </div>

          {posts.length === 0 ? (
            <p className="import-status">No posts found on that site.</p>
          ) : (
            <ul className="import-list">
              {posts.map((post) => {
                const done = importedIds.has(post.ID)
                return (
                  <li key={post.ID} className={done ? 'imported' : ''}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(post.ID)}
                        onChange={() => toggleSelected(post.ID)}
                        disabled={done}
                      />
                      <div className="import-post-info">
                        <div className="import-post-title">
                          {post.title || '(untitled)'}
                          {done && <span className="import-post-done"> — Imported ✓</span>}
                        </div>
                        <div className="import-post-meta">{formatDate(post.date)}</div>
                        {post.excerpt && (
                          <div
                            className="import-post-excerpt"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.excerpt) }}
                          />
                        )}
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {posts.length < found && (
            <button type="button" className="link" onClick={handleLoadMore} disabled={fetching}>
              {fetching ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
