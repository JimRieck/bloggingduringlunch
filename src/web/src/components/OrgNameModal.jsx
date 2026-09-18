import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Field } from './Field.jsx'
import { Modal } from './Modal.jsx'

// RLS ("Admins can update their organization", is_org_admin -- owner or
// admin) is the only check this needs; NavPane only renders the entry
// point that opens this modal for someone who already passes it.
export function OrgNameModal({ organizationId, currentName, onRenamed, onClose }) {
  const [name, setName] = useState(currentName)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter an organization name.')
      return
    }
    setError('')
    setSaving(true)

    const { error: updateError } = await supabase
      .from('organizations')
      .update({ name: trimmed })
      .eq('id', organizationId)

    setSaving(false)
    if (updateError) {
      setError("Couldn't save the organization name. Try again.")
      return
    }
    onRenamed(trimmed)
    onClose()
  }

  return (
    <Modal title="Organization settings" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <Field label="Organization name" error={error}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
        </Field>
        <button type="submit" className="primary" disabled={saving || !name.trim() || name.trim() === currentName.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  )
}
