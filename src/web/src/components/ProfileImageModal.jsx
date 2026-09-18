import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Avatar } from './Avatar.jsx'
import { Field } from './Field.jsx'
import { Modal } from './Modal.jsx'
import './ProfileImageModal.css'

export function ProfileImageModal({ userId, currentUrl, currentName, label, onUploaded, onNameUpdated, onClose }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState(currentName ?? '')
  const [nameError, setNameError] = useState('')
  const [savingName, setSavingName] = useState(false)

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)

    setUploading(false)
    if (updateError) {
      setError(updateError.message)
      return
    }

    onUploaded(publicUrl)
  }

  async function handleSaveName(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Enter a name.')
      return
    }
    setNameError('')
    setSavingName(true)

    // A single-column payload, deliberately -- profiles' RLS update
    // policy ("own row") isn't column-restricted, so only ever sending
    // {display_name} here (never the whole row) is what actually keeps
    // this call from being able to touch avatar_url/is_site_admin/etc.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', userId)

    setSavingName(false)
    if (updateError) {
      setNameError("Couldn't save your name. Try again.")
      return
    }
    onNameUpdated(trimmed)
  }

  return (
    <Modal title="Edit profile" onClose={onClose}>
      <div className="profile-image-preview">
        <Avatar url={currentUrl} label={label} />
      </div>
      <label className="profile-image-upload">
        {uploading ? 'Uploading…' : 'Choose a new photo'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={handleUpload}
          disabled={uploading}
        />
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      <form className="profile-name-form" onSubmit={handleSaveName} noValidate>
        <Field label="Name" error={nameError}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={savingName} />
        </Field>
        <button
          type="submit"
          className="primary"
          disabled={savingName || !name.trim() || name.trim() === (currentName ?? '').trim()}
        >
          {savingName ? 'Saving…' : 'Save name'}
        </button>
      </form>
    </Modal>
  )
}
