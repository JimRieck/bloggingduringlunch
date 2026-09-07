import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { Avatar } from './Avatar.jsx'
import { ProfileImageModal } from './ProfileImageModal.jsx'
import { InviteMemberModal } from './InviteMemberModal.jsx'
import './NavPane.css'

function getStoredCollapsed() {
  try {
    return localStorage.getItem('nav-collapsed') === 'true'
  } catch {
    return false
  }
}

export function NavPane({ userId, profile, displayName, email, ownedOrg, isSiteAdmin, onAvatarUploaded }) {
  const [collapsed, setCollapsed] = useState(getStoredCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showImageModal, setShowImageModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const showLabels = !collapsed || mobileOpen

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
    <>
      <button
        type="button"
        id="mobile-nav-toggle"
        onClick={() => setMobileOpen(true)}
        title="Open navigation"
      >
        ☰
      </button>

      {mobileOpen && (
        <div id="nav-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}

      <nav id="nav-pane" className={`${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        <button
          type="button"
          id="nav-toggle"
          onClick={toggle}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? '»' : '«'}
        </button>
        <button
          type="button"
          id="nav-close"
          onClick={() => setMobileOpen(false)}
          title="Close navigation"
        >
          ✕
        </button>

        <div id="nav-profile">
          <button
            type="button"
            id="nav-avatar-button"
            onClick={() => {
              setShowImageModal(true)
              setMobileOpen(false)
            }}
            title="Change profile photo"
          >
            <Avatar url={profile?.avatar_url} label={displayName || email} />
          </button>
          {showLabels && <span id="nav-author-name">{displayName || email}</span>}
        </div>

        <div id="nav-links">
          <a href="/" title="My posts">
            <span className="nav-icon" aria-hidden="true">
              📝
            </span>
            {showLabels && <span>My posts</span>}
          </a>
          <a href="/search" title="Search">
            <span className="nav-icon" aria-hidden="true">
              🔍
            </span>
            {showLabels && <span>Search</span>}
          </a>
          <a href="/posts/new" title="New post">
            <span className="nav-icon" aria-hidden="true">
              ➕
            </span>
            {showLabels && <span>New post</span>}
          </a>
          <a href="/directory" target="_blank" rel="noopener noreferrer" title="Open user directory in a new tab">
            <span className="nav-icon" aria-hidden="true">
              👥
            </span>
            {showLabels && (
              <>
                <span>User directory</span>
                <img src="/icons/external-link.svg" alt="Opens in a new tab" className="nav-new-tab-icon" />
              </>
            )}
          </a>
          {ownedOrg && (
            <button type="button" onClick={() => setShowInviteModal(true)} title="Invite by email">
              <span className="nav-icon" aria-hidden="true">
                ✉️
              </span>
              {showLabels && <span>Invite by email</span>}
            </button>
          )}
          {isSiteAdmin && (
            <a href="/admin" title="Site admin">
              <span className="nav-icon" aria-hidden="true">
                🛡️
              </span>
              {showLabels && <span>Site admin</span>}
            </a>
          )}
        </div>

        {ownedOrg && showLabels && (
          <p id="nav-invite-code">
            Invite code for {ownedOrg.name}: <code>{ownedOrg.invite_code}</code>
          </p>
        )}

        <button type="button" id="nav-logout" onClick={() => supabase.auth.signOut()} title="Log out">
          <span className="nav-icon" aria-hidden="true">
            🚪
          </span>
          {showLabels && <span>Log out</span>}
        </button>
      </nav>

      {showImageModal && (
        <ProfileImageModal
          userId={userId}
          currentUrl={profile?.avatar_url}
          label={displayName || email}
          onUploaded={onAvatarUploaded}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {showInviteModal && <InviteMemberModal onClose={() => setShowInviteModal(false)} />}
    </>
  )
}
