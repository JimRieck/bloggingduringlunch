import { useState } from 'react'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import { supabase } from '../lib/supabaseClient.js'
import { postEditorExtensions } from '../lib/postEditorExtensions.js'
import { buildAnnouncementEmail } from '../lib/announcementEmail.js'
import { describeSendError } from '../lib/announcements.js'
import { EditorToolbar } from './RichTextEditor.jsx'
import { ImagePicker } from './ImagePicker.jsx'
import { AnnouncementRecipients } from './AnnouncementRecipients.jsx'
import { Field } from './Field.jsx'

// Writing one announcement: subject + body in the post editor, who it
// goes to (everyone by default), saved as a draft, test-sent to
// yourself, or sent. The
// parent remounts this (via `key`) to switch to another draft or start a
// new one, so `announcement` is only read once, as the starting point.
export function AnnouncementForm({ announcement, organizationId, userId, userEmail, recipients, onSaved, onSent, onDirtyChange }) {
  const [id, setId] = useState(announcement?.id ?? null)
  const [subject, setSubject] = useState(announcement?.subject ?? '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [excludedIds, setExcludedIds] = useState(() => new Set(announcement?.excluded_user_ids ?? []))
  const selectedCount = (recipients ?? []).filter((r) => !excludedIds.has(r.user_id)).length

  const editor = useEditor({
    extensions: postEditorExtensions(),
    content: announcement?.body_html ?? '',
    onUpdate: () => onDirtyChange(true),
  })
  const isBodyEmpty = useEditorState({ editor, selector: ({ editor }) => !editor || editor.isEmpty })

  function handleSubjectChange(e) {
    setSubject(e.target.value)
    onDirtyChange(true)
  }

  // Saves the current subject/body (plus the email version built from
  // them) and returns the saved row's id, or null after showing an error.
  async function save() {
    const bodyHtml = editor.getHTML()
    const { html, text } = buildAnnouncementEmail({ subject, bodyHtml, siteUrl: window.location.origin })
    const payload = {
      subject: subject.trim(),
      body_html: bodyHtml,
      email_html: html,
      email_text: text,
      excluded_user_ids: [...excludedIds],
    }
    const query = id
      ? supabase.from('announcements').update(payload).eq('id', id)
      : supabase.from('announcements').insert(payload)
    const { data, error: saveError } = await query.select().single()
    if (saveError) {
      setError(
        id && saveError.code === 'PGRST116'
          ? 'This announcement has already been sent, so it can’t be changed.'
          : 'Couldn’t save the draft. Try again.',
      )
      return null
    }
    setId(data.id)
    onDirtyChange(false)
    onSaved(data)
    return data.id
  }

  async function handleSaveDraft() {
    setError('')
    setNotice('')
    setBusy('save')
    const savedId = await save()
    setBusy('')
    if (savedId) setNotice('Draft saved.')
  }

  function readyToSend() {
    if (!subject.trim()) {
      setError('Add a subject first.')
      return false
    }
    if (isBodyEmpty) {
      setError('Write the announcement first.')
      return false
    }
    return true
  }

  async function invokeSend(announcementId, test) {
    const { data, error: invokeError } = await supabase.functions.invoke('send-announcement', {
      body: { announcementId, test },
    })
    if (!invokeError) return { data }
    let reason
    try {
      reason = (await invokeError.context.json())?.error
    } catch {
      // not JSON -- fall back to the generic message
    }
    return { error: describeSendError(reason) }
  }

  async function handleSendTest() {
    setError('')
    setNotice('')
    if (!readyToSend()) return
    setBusy('test')
    const savedId = await save()
    if (!savedId) {
      setBusy('')
      return
    }
    const result = await invokeSend(savedId, true)
    setBusy('')
    if (result.error) setError(result.error)
    else setNotice(`Test sent to ${userEmail}. The draft is saved and hasn’t gone to anyone else.`)
  }

  async function handleSendAll() {
    setError('')
    setNotice('')
    if (!readyToSend()) return
    if (selectedCount === 0) {
      setError('Select at least one person to send it to.')
      return
    }
    if (
      !window.confirm(
        `Send “${subject.trim()}” to ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}? This can’t be undone.`,
      )
    ) {
      return
    }
    setBusy('send')
    const savedId = await save()
    if (!savedId) {
      setBusy('')
      return
    }
    const result = await invokeSend(savedId, false)
    setBusy('')
    if (result.error) {
      setError(result.error)
      return
    }
    onSent(result.data)
  }

  function handleImageSelected(url) {
    editor.chain().focus().setImage({ src: url }).run()
    setPickerOpen(false)
  }

  return (
    <section className="announcement-form">
      <Field label="Subject">
        <input type="text" value={subject} maxLength={200} onChange={handleSubjectChange} placeholder="What’s new?" />
      </Field>
      <div className="field">
        <span>Message</span>
        <div className="editor-shell">
          <EditorToolbar editor={editor} onInsertImage={organizationId ? () => setPickerOpen(true) : undefined} />
          <EditorContent editor={editor} className="editor-content" />
        </div>
      </div>

      {recipients && (
        <AnnouncementRecipients
          recipients={recipients}
          excludedIds={excludedIds}
          onChange={(next) => {
            setExcludedIds(next)
            onDirtyChange(true)
          }}
        />
      )}

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

      <div className="announcement-actions">
        <button type="button" className="secondary" disabled={!!busy} onClick={handleSaveDraft}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className="secondary" disabled={!!busy} onClick={handleSendTest}>
          {busy === 'test' ? 'Sending test…' : 'Send test to me'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!!busy || !recipients || selectedCount === 0}
          onClick={handleSendAll}
        >
          {busy === 'send'
            ? 'Sending…'
            : `Send to ${selectedCount} ${selectedCount === 1 ? 'person' : 'people'}`}
        </button>
      </div>

      {pickerOpen && (
        <ImagePicker
          organizationId={organizationId}
          userId={userId}
          onSelect={handleImageSelected}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  )
}
