import { useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useFeatureFlags } from '../lib/featureFlags.js'
import { useAccountStore, useSession } from '../stores/index.js'
import { Avatar } from './Avatar.jsx'
import { ProfileImageModal } from './ProfileImageModal.jsx'
import { InviteMemberModal } from './InviteMemberModal.jsx'
import { OrgNameModal } from './OrgNameModal.jsx'
import './NavPane.css'

function getStoredCollapsed() {
  try {
    return localStorage.getItem('nav-collapsed') === 'true'
  } catch {
    return false
  }
}

// A labeled group of nav rows (e.g. "Org Admin", "Site Admin") --
// the label itself follows the same showLabels rule as every other
// row's text: hidden when the sidebar is collapsed, icons only.
function NavSection({ label, showLabels, children }) {
  return (
    <div className="nav-section">
      {showLabels && <div className="nav-section-label">{label}</div>}
      {children}
    </div>
  )
}

// Reads the signed-in person's account straight from the stores, so
// App.jsx only has to place it.
export function NavPane() {
  const session = useSession()
  const profile = useAccountStore((s) => s.profile)
  const ownedOrgId = useAccountStore((s) => s.ownedOrgId)
  const orgAdmin = useAccountStore((s) => s.orgAdmin)
  const canImport = useAccountStore((s) => Boolean(s.authorOrg))
  const isSiteAdmin = useAccountStore((s) => s.isSiteAdmin)
  const updateProfile = useAccountStore((s) => s.updateProfile)
  const renameOrg = useAccountStore((s) => s.renameOrg)
  const userId = session.user.id
  const email = session.user.email
  const displayName = profile?.display_name
  const [collapsed, setCollapsed] = useState(getStoredCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showImageModal, setShowImageModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showOrgModal, setShowOrgModal] = useState(false)
  const showLabels = !collapsed || mobileOpen
  const featureFlags = useFeatureFlags()

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
            title="Edit profile"
          >
            <Avatar url={profile?.avatar_url} label={displayName || email} />
          </button>
          {showLabels && <span id="nav-author-name">{displayName || email}</span>}
        </div>

        <div id="nav-links">
          <div className="nav-link-row">
            <a href="/" title="My posts" className="nav-link-main">
              <span className="nav-icon" aria-hidden="true">
                📝
              </span>
              {showLabels && <span>My posts</span>}
            </a>
            <a href="/posts/new" title="New post" className="nav-link-inline-action">
              <span className="nav-icon" aria-hidden="true">
                ➕
              </span>
            </a>
          </div>
          <a href="/search" title="Search">
            <span className="nav-icon" aria-hidden="true">
              🔍
            </span>
            {showLabels && <span>Search</span>}
          </a>
          <a href="/suggestions" title="Suggestions">
            <span className="nav-icon" aria-hidden="true">
              💡
            </span>
            {showLabels && <span>Suggestions</span>}
          </a>
          {canImport && (
            <a href="/posts/import" title="Import from WordPress">
              <span className="nav-icon" aria-hidden="true">
                📥
              </span>
              {showLabels && <span>Import from WordPress</span>}
            </a>
          )}
          {canImport && featureFlags.linkedin_posting && (
            <a href="/social" title="Social posting">
              <span className="nav-icon" aria-hidden="true">
                📣
              </span>
              {showLabels && <span>Social posting</span>}
            </a>
          )}
          {canImport && featureFlags.ai_bulk_auto_tag && (
            <a href="/posts/bulk-tag" title="Auto-tag posts">
              <span className="nav-icon" aria-hidden="true">
                ✨
              </span>
              {showLabels && <span>Auto-tag posts</span>}
            </a>
          )}

          {(ownedOrgId || orgAdmin) && (
            <NavSection label="Org Admin" showLabels={showLabels}>
              {ownedOrgId && (
                <button type="button" onClick={() => setShowInviteModal(true)} title="Invite by email">
                  <span className="nav-icon" aria-hidden="true">
                    ✉️
                  </span>
                  {showLabels && <span>Invite by email</span>}
                </button>
              )}
              {orgAdmin && (
                <button type="button" onClick={() => setShowOrgModal(true)} title="Organization settings">
                  <span className="nav-icon" aria-hidden="true">
                    🏢
                  </span>
                  {showLabels && <span>Organization settings</span>}
                </button>
              )}
            </NavSection>
          )}

          {isSiteAdmin && (
            <NavSection label="Site Admin" showLabels={showLabels}>
              <a href="/admin" title="Website Stats">
                <span className="nav-icon" aria-hidden="true">
                  🛡️
                </span>
                {showLabels && <span>Website Stats</span>}
              </a>
              <a href="/admin/announcements" title="Announcements">
                <span className="nav-icon" aria-hidden="true">
                  📬
                </span>
                {showLabels && <span>Announcements</span>}
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
            </NavSection>
          )}
        </div>

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
          currentName={displayName}
          label={displayName || email}
          onUploaded={(url) => updateProfile({ avatar_url: url })}
          onNameUpdated={(name) => updateProfile({ display_name: name })}
          onClose={() => setShowImageModal(false)}
        />
      )}

      {showInviteModal && <InviteMemberModal onClose={() => setShowInviteModal(false)} />}

      {showOrgModal && orgAdmin && (
        <OrgNameModal
          organizationId={orgAdmin.id}
          currentName={orgAdmin.name}
          onRenamed={(name) => renameOrg(orgAdmin.id, name)}
          onClose={() => setShowOrgModal(false)}
        />
      )}
    </>
  )
}
