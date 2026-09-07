import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import './UserDirectory.css'
import './AdminPanel.css'

export function AdminPanel({ session }) {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState(null)

  function load() {
    supabase
      .from('profiles')
      .select('id, email, display_name, user_type, disabled')
      .order('email')
      .then(({ data }) => setUsers(data ?? []))
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleDisabled(user) {
    setError('')
    setPendingId(user.id)
    const { error: invokeError } = await supabase.functions.invoke('admin-set-account-status', {
      body: { userId: user.id, disabled: !user.disabled },
    })
    setPendingId(null)
    if (invokeError) {
      setError(`Couldn't update ${user.email}. Try again.`)
      return
    }
    setUsers((current) =>
      current.map((u) => (u.id === user.id ? { ...u, disabled: !u.disabled } : u)),
    )
  }

  if (users === null) {
    return (
      <div id="directory" className="directory-status">
        <p>Loading…</p>
      </div>
    )
  }

  return (
    <div id="directory">
      <h1>Site admin</h1>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="directory-table-wrap">
        <table className="directory-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <div className="directory-name">{user.display_name || '—'}</div>
                  <div className="directory-email">{user.email}</div>
                </td>
                <td>{user.user_type}</td>
                <td>
                  <span className={`admin-status-badge ${user.disabled ? 'disabled' : 'active'}`}>
                    {user.disabled ? 'disabled' : 'active'}
                  </span>
                </td>
                <td>
                  {user.id === session.user.id ? (
                    <span className="admin-self-note">this is you</span>
                  ) : (
                    <button
                      type="button"
                      className="link"
                      onClick={() => toggleDisabled(user)}
                      disabled={pendingId === user.id}
                    >
                      {pendingId === user.id ? 'Working…' : user.disabled ? 'Enable' : 'Disable'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
