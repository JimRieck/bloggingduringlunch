import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Avatar } from './Avatar.jsx'
import './ProfileImageModal.css'

export function ProfileImageModal({ userId, currentUrl, label, onUploaded, onClose }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

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
    onClose()
  }

  return (
    <div className="profile-image-overlay" onClick={onClose}>
      <div className="profile-image-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-image-header">
          <h3>Profile photo</h3>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
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
      </div>
    </div>
  )
}
