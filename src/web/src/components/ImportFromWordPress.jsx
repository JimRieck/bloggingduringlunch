import { useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabaseClient.js'
import './ImportFromWordPress.css'

const PAGE_SIZE = 20

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// WordPress.com's API sometimes hands back a stray empty heading block
// (e.g. `<h1 class="wp-block-heading"></h1>`) ahead of the real body --
// the post's title is already stored separately in `posts.title`, so an
// empty heading here is just noise, not lost content.
function stripEmptyHeadings(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    if (!el.textContent.trim()) el.remove()
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
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [posts, setPosts] = useState(null)
  const [found, setFound] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [importedIds, setImportedIds] = useState(new Set())
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importNotice, setImportNotice] = useState('')

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

  async function fetchPage(site, pageNum, append) {
    setFetching(true)
    setFetchError('')
    try {
      const url = `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}/posts/?number=${PAGE_SIZE}&page=${pageNum}&fields=ID,title,date,excerpt,content`
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

  async function handleImport() {
    const organizationId = membership.organizations.id
    const toImport = (posts ?? []).filter((p) => selectedIds.has(p.ID))
    if (toImport.length === 0) return

    setImporting(true)
    setImportError('')
    setImportNotice('')

    const rows = toImport.map((p) => ({
      organization_id: organizationId,
      author_id: session.user.id,
      title: p.title?.trim() || 'Untitled',
      content: DOMPurify.sanitize(stripEmptyHeadings(p.content || '')),
      status: 'draft',
    }))

    const { error } = await supabase.from('posts').insert(rows)

    setImporting(false)
    if (error) {
      setImportError(error.message)
      return
    }

    setImportedIds((current) => {
      const next = new Set(current)
      toImport.forEach((p) => next.add(p.ID))
      return next
    })
    setSelectedIds(new Set())
    setImportNotice(
      `Imported ${toImport.length} post${toImport.length === 1 ? '' : 's'} as draft${toImport.length === 1 ? '' : 's'}. Review and publish from My posts.`,
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
              {importing ? 'Importing…' : `Import ${selectedIds.size || ''} selected`}
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
