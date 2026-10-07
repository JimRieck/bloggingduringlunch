import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { describeDelivery } from '../lib/announcements.js'
import { AnnouncementForm } from './AnnouncementForm.jsx'
import { AnnouncementHistory } from './AnnouncementHistory.jsx'
import { Accordion } from './Accordion.jsx'
import './Announcements.css'

// /admin/announcements: email feature announcements to every active
// user. The composer at the top, saved drafts below it, then everything
// sent so far.
export function AnnouncementsAdmin({ session }) {
  const [announcements, setAnnouncements] = useState(null)
  const [senderNames, setSenderNames] = useState({})
  const [recipients, setRecipients] = useState(null)
  const [organizationId, setOrganizationId] = useState(null)
  // `key` remounts the form; it only changes on New / Edit, not on save.
  const [editing, setEditing] = useState({ key: 'new', announcement: null })
  // The draft being edited -- set on Edit, and when a new one is first saved.
  const [currentId, setCurrentId] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: rows, error: loadError }, { data: recipientRows }, { data: membership }] = await Promise.all([
        supabase
          .from('announcements')
          .select(
            'id, subject, body_html, email_html, excluded_user_ids, status, updated_at, sent_at, sent_by, recipient_count, failed_count',
          )
          .order('updated_at', { ascending: false }),
        supabase.rpc('announcement_recipient_list'),
        // For the editor's image picker -- images go into the admin's
        // own blog's library, same as the post editor.
        supabase
          .from('memberships')
          .select('organization_id')
          .eq('user_id', session.user.id)
          .in('role', ['owner', 'editor'])
          .limit(1)
          .maybeSingle(),
      ])
      if (cancelled) return
      if (loadError) setError('Couldn’t load announcements. Reload to try again.')

      const senderIds = [...new Set((rows ?? []).map((r) => r.sent_by).filter(Boolean))]
      const { data: profiles } = senderIds.length
        ? await supabase.from('profiles').select('id, display_name, email').in('id', senderIds)
        : { data: [] }
      if (cancelled) return

      setAnnouncements(rows ?? [])
      setSenderNames(Object.fromEntries((profiles ?? []).map((p) => [p.id, p.display_name || p.email])))
      setRecipients(recipientRows ?? [])
      setOrganizationId(membership?.organization_id ?? null)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [session.user.id, reloadKey])

  function startEditing(announcement) {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setNotice('')
    setDirty(false)
    setEditing({ key: announcement?.id ?? `new-${Date.now()}`, announcement })
    setCurrentId(announcement?.id ?? null)
  }

  function handleSaved(row) {
    setCurrentId(row.id)
    setAnnouncements((current) => [row, ...(current ?? []).filter((a) => a.id !== row.id)])
  }

  function handleSent(result) {
    setDirty(false)
    setNotice(describeDelivery({ recipient_count: result.sent, failed_count: result.failed }) + '.')
    setCurrentId(null)
    setEditing({ key: `new-${Date.now()}`, announcement: null })
    setReloadKey((k) => k + 1)
  }

  async function handleDelete(draft) {
    if (!window.confirm(`Delete the draft “${draft.subject || 'Untitled'}”?`)) return
    const { error: deleteError } = await supabase.from('announcements').delete().eq('id', draft.id)
    if (deleteError) {
      setError('Couldn’t delete that draft. Try again.')
      return
    }
    setAnnouncements((current) => current.filter((a) => a.id !== draft.id))
    if (currentId === draft.id) {
      setCurrentId(null)
      setDirty(false)
      setEditing({ key: `new-${Date.now()}`, announcement: null })
    }
  }

  if (announcements === null) {
    return (
      <div id="announcements" className="directory-status">
        <p>Loading…</p>
      </div>
    )
  }

  const drafts = announcements.filter((a) => a.status === 'draft')
  const sent = announcements
    .filter((a) => a.status !== 'draft')
    .sort((a, b) => (b.sent_at ?? b.updated_at).localeCompare(a.sent_at ?? a.updated_at))
  const editingId = currentId

  return (
    <div id="announcements">
      <h1>Announcements</h1>
      <p className="announcement-intro">
        Email a feature announcement to active users (confirmed email, not disabled) — everyone by default, or just the
        people you pick. Each person gets their own copy.
      </p>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="auth-notice" role="status">
          {notice}
        </p>
      )}

      <div className="announcement-form-header">
        <h2>{editingId ? 'Edit draft' : 'New announcement'}</h2>
        {editingId && (
          <button type="button" className="announcement-row-action" onClick={() => startEditing(null)}>
            + New announcement
          </button>
        )}
      </div>
      <AnnouncementForm
        key={editing.key}
        announcement={editing.announcement}
        organizationId={organizationId}
        userId={session.user.id}
        userEmail={session.user.email}
        recipients={recipients}
        onSaved={handleSaved}
        onSent={handleSent}
        onDirtyChange={setDirty}
      />

      <Accordion title={`Drafts (${drafts.length})`} defaultOpen={drafts.length > 0}>
        {drafts.length === 0 ? (
          <p className="announcement-empty">No saved drafts.</p>
        ) : (
          <ul className="announcement-list">
            {drafts.map((d) => (
              <li key={d.id} className={`announcement-row${d.id === editingId ? ' editing' : ''}`}>
                <div className="announcement-row-main">
                  <div className="announcement-subject">{d.subject || 'Untitled'}</div>
                  <div className="announcement-meta">
                    {d.id === editingId ? 'Editing now · ' : ''}Last saved {new Date(d.updated_at).toLocaleString()}
                  </div>
                </div>
                <div className="announcement-row-buttons">
                  <button
                    type="button"
                    className="announcement-row-action"
                    disabled={d.id === editingId}
                    onClick={() => startEditing(d)}
                  >
                    Edit
                  </button>
                  <button type="button" className="announcement-row-action" onClick={() => handleDelete(d)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Accordion>

      <Accordion title={`Sent (${sent.length})`} defaultOpen>
        <AnnouncementHistory announcements={sent} senderNames={senderNames} />
      </Accordion>
    </div>
  )
}
