import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './ImagePicker.css'

export function ImagePicker({ organizationId, userId, onSelect, onClose }) {
  const [images, setImages] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('post_images')
      .select('id, url')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setImages(data ?? []))
  }, [organizationId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    const ext = file.name.split('.').pop()
    const path = `${organizationId}/${crypto.randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('post-images').upload(path, file)
    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('post-images').getPublicUrl(path)

    const { error: insertError } = await supabase.from('post_images').insert({
      organization_id: organizationId,
      uploaded_by: userId,
      url: publicUrl,
      storage_path: path,
    })

    setUploading(false)
    if (insertError) {
      setError(insertError.message)
      return
    }

    onSelect(publicUrl)
  }

  return (
    <div className="image-picker-overlay" onClick={onClose}>
      <div className="image-picker" onClick={(e) => e.stopPropagation()}>
        <div className="image-picker-header">
          <h3>Choose an image</h3>
          <button type="button" className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <label className="image-picker-upload">
          {uploading ? 'Uploading…' : 'Upload a new image'}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleUpload} disabled={uploading} />
        </label>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        {images === null ? (
          <p className="image-picker-status">Loading…</p>
        ) : images.length === 0 ? (
          <p className="image-picker-status">No past uploads yet for this blog.</p>
        ) : (
          <div className="image-picker-grid">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                className="image-picker-thumb"
                onClick={() => onSelect(img.url)}
              >
                <img src={img.url} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
