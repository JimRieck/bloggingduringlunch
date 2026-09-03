import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './ProfileSetupBanner.css'

export function ProfileSetupBanner({ userId, onUploaded, onDismissed }) {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleDismiss() {
    const { error: dismissError } = await supabase
      .from('profiles')
      .update({ profile_setup_dismissed: true })
      .eq('id', userId)
    if (dismissError) {
      setError(dismissError.message)
      return
    }
    onDismissed()
  }

  async function handleUpload(e) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError('')

    const ext = file.name.split('.').pop()
    const path = `${userId}/avatar.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      setError(uploadError.message)
      setUploading(false)
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

  return (
    <form id="profile-setup-banner" onSubmit={handleUpload}>
      <span>Finish setting up your profile — add a photo.</span>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button type="submit" className="link" disabled={!file || uploading}>
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
      <button type="button" className="link" onClick={handleDismiss}>
        Not now
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </form>
  )
}
