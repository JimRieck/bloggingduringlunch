import { useEffect, useState } from 'react'
import { Avatar } from './Avatar.jsx'
import { AuthPanel } from './AuthPanel.jsx'
import { supabase } from '../lib/supabaseClient.js'
import './UserDirectory.css'

function formatUserType(type) {
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : '—'
}

export function UserDirectory({ session }) {
  const [users, setUsers] = useState(null)

  useEffect(() => {
    if (!session) return
    supabase
      .from('user_directory')
      .select('*')
      .then(({ data }) => setUsers(data ?? []))
  }, [session])

  if (!session) {
    return (
      <div id="directory-gate">
        <p>Log in to view the user directory.</p>
        <AuthPanel />
      </div>
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
      <h1>Users</h1>
      {users.length === 0 ? (
        <p className="directory-status">No users yet.</p>
      ) : (
        <div className="directory-table-wrap">
          <table className="directory-table">
            <thead>
              <tr>
                <th></th>
                <th>User</th>
                <th>Type</th>
                <th>Organization</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Avatar url={user.avatar_url} label={user.display_name || user.email} />
                  </td>
                  <td>
                    <div className="directory-name">{user.display_name || '—'}</div>
                    <div className="directory-email">{user.email}</div>
                  </td>
                  <td>{formatUserType(user.user_type)}</td>
                  <td>{user.organizations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
