import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Avatar } from './Avatar.jsx'
import { ProfileImageModal } from './ProfileImageModal.jsx'
import './NavPane.css'

function getStoredCollapsed() {
  try {
    return localStorage.getItem('nav-collapsed') === 'true'
  } catch {
    return false
  }
}

export function NavPane({ userId, profile, displayName, email, ownedOrg, onAvatarUploaded }) {
  const [collapsed, setCollapsed] = useState(getStoredCollapsed)
  const [showImageModal, setShowImageModal] = useState(false)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem('nav-collapsed', String(next))
    } catch {
      // ignore -- private browsing / storage disabled
    }
  }

  return (
    <nav id="nav-pane" className={collapsed ? 'collapsed' : ''}>
      <button
        type="button"
        id="nav-toggle"
        onClick={toggle}
        title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        {collapsed ? '»' : '«'}
      </button>

      <div id="nav-profile">
        <button
          type="button"
          id="nav-avatar-button"
          onClick={() => setShowImageModal(true)}
          title="Change profile photo"
        >
          <Avatar url={profile?.avatar_url} label={displayName || email} />
        </button>
        {!collapsed && <span id="nav-author-name">{displayName || email}</span>}
      </div>

      <div id="nav-links">
        <a href="/" title="My posts">
          <span className="nav-icon" aria-hidden="true">
            📝
          </span>
          {!collapsed && <span>My posts</span>}
        </a>
        <a href="/posts/new" title="New post">
          <span className="nav-icon" aria-hidden="true">
            ➕
          </span>
          {!collapsed && <span>New post</span>}
        </a>
        <a href="/directory" target="_blank" rel="noopener noreferrer" title="Open user directory in a new tab">
          <span className="nav-icon" aria-hidden="true">
            👥
          </span>
          {!collapsed && (
            <>
              <span>User directory</span>
              <img src="/icons/external-link.svg" alt="Opens in a new tab" className="nav-new-tab-icon" />
            </>
          )}
        </a>
      </div>

      {ownedOrg && !collapsed && (
        <p id="nav-invite-code">
          Invite code for {ownedOrg.name}: <code>{ownedOrg.invite_code}</code>
        </p>
      )}

      <button type="button" id="nav-logout" onClick={() => supabase.auth.signOut()} title="Log out">
        <span className="nav-icon" aria-hidden="true">
          🚪
        </span>
        {!collapsed && <span>Log out</span>}
      </button>

      {showImageModal && (
        <ProfileImageModal
          userId={userId}
          currentUrl={profile?.avatar_url}
          label={displayName || email}
          onUploaded={onAvatarUploaded}
          onClose={() => setShowImageModal(false)}
        />
      )}
    </nav>
  )
}
