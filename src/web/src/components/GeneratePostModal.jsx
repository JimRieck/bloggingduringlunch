import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Modal } from './Modal.jsx'
import './GeneratePostModal.css'

// Only reports the generated content up via onGenerated -- PostForm
// decides whether to confirm before overwriting existing body content
// (it owns the editor instance and knows whether it's empty) and
// closes the modal itself once applied.
export function GeneratePostModal({ onGenerated, onClose }) {
  const [description, setDescription] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    if (!description.trim()) return
    setGenerating(true)
    setError('')

    const { data, error: generateError } = await supabase.functions.invoke('generate-post-content', {
      body: { description: description.trim() },
    })
    setGenerating(false)

    if (generateError || data?.error) {
      let reason = data?.error
      if (!reason && generateError?.context) {
        try {
          reason = (await generateError.context.json())?.error
        } catch {
          // context wasn't JSON, or already consumed -- fall through
        }
      }
      setError(
        reason === 'not_configured'
          ? 'Generating drafts isn’t configured yet.'
          : 'Couldn’t generate a draft. Try again.',
      )
      return
    }
    onGenerated(data.content)
  }

  return (
    <Modal title="Generate a draft" onClose={onClose}>
      <p className="generate-post-intro">
        Describe what this post should be about, and a draft will be written for you to edit.
      </p>
      <textarea
        className="generate-post-textarea"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. A retrospective on migrating our image pipeline to a CDN, what broke, and what we'd do differently."
        rows={5}
        disabled={generating}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="generate-post-actions">
        <button type="button" className="link" onClick={onClose} disabled={generating}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleGenerate}
          disabled={generating || !description.trim()}
        >
          {generating ? 'Generating…' : 'Generate draft'}
        </button>
      </div>
    </Modal>
  )
}
