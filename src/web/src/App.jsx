import { useEffect, useState } from 'react'
import './App.css'
import { AdminPanel } from './components/AdminPanel.jsx'
import { AuthPanel } from './components/AuthPanel.jsx'
import { SetNewPasswordForm } from './components/SetNewPasswordForm.jsx'
import { NavPane } from './components/NavPane.jsx'
import { ProfileSetupBanner } from './components/ProfileSetupBanner.jsx'
import { PostForm } from './components/PostForm.jsx'
import { MyPosts } from './components/MyPosts.jsx'
import { RecentPosts } from './components/RecentPosts.jsx'
import { Search } from './components/Search.jsx'
import { TenantBlog } from './components/TenantBlog.jsx'
import { UserDirectory } from './components/UserDirectory.jsx'
import { supabase } from './lib/supabaseClient.js'
import { getTenantSlugFromHostname } from './lib/tenant.js'

function App() {
  const tenantSlug = getTenantSlugFromHostname()
  const [showLogin, setShowLogin] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [ownedOrg, setOwnedOrg] = useState(null)
  const [authorOrg, setAuthorOrg] = useState(undefined)
  const [isSiteAdmin, setIsSiteAdmin] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [disabledNotice, setDisabledNotice] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      // supabase-js has no distinct INVITE event -- an admin-generated
      // invite link fires plain SIGNED_IN, so a `?invited=1` marker on
      // the invite email's redirectTo is how we detect "this login
      // needs to set a password," same as a real recovery link.
      if (event === 'SIGNED_IN' && new URLSearchParams(window.location.search).get('invited') === '1') {
        setPasswordRecovery(true)
        window.history.replaceState({}, '', window.location.pathname)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('display_name, avatar_url, profile_setup_dismissed, disabled')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  useEffect(() => {
    // Auth-level bans (see AdminPanel.jsx) block new logins/refreshes
    // immediately but don't revoke an already-issued access token, so
    // an already-open session could otherwise keep working for up to
    // an hour. This closes that gap client-side as soon as we notice.
    if (profile?.disabled) {
      setDisabledNotice(true)
      setShowLogin(true)
      supabase.auth.signOut()
    }
  }, [profile])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('is_site_admin')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setIsSiteAdmin(data?.is_site_admin ?? false))
  }, [session])

  useEffect(() => {
    if (!session) return
    supabase
      .from('memberships')
      .select('organization_id')
      .eq('user_id', session.user.id)
      .eq('role', 'owner')
      .maybeSingle()
      .then(({ data }) => setOwnedOrg(data?.organization_id ?? null))
  }, [session])

  useEffect(() => {
    if (!session) return
    supabase
      .from('memberships')
      .select('role, organizations(id, name, slug)')
      .eq('user_id', session.user.id)
      .in('role', ['owner', 'editor'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setAuthorOrg(data ? { ...data.organizations, role: data.role } : null))
  }, [session])

  const pathname = window.location.pathname

  if (tenantSlug) {
    const postSlug = pathname.slice(1) || undefined
    return <TenantBlog slug={tenantSlug} postSlug={postSlug} session={session} />
  }

  if (pathname.startsWith('/blog/')) {
    const [orgSlug, postSlug] = pathname.slice('/blog/'.length).split('/')
    return <TenantBlog slug={orgSlug} postSlug={postSlug || undefined} session={session} />
  }

  let content
  if (pathname === '/directory') {
    content = <UserDirectory session={session} />
  } else if (pathname === '/admin') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to access site admin.</p>
          <AuthPanel />
        </div>
      )
    } else if (!isSiteAdmin) {
      content = (
        <div id="directory-gate">
          <p>You don&rsquo;t have access to this page.</p>
        </div>
      )
    } else {
      content = <AdminPanel session={session} />
    }
  } else if (pathname === '/search') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to search.</p>
          <AuthPanel />
        </div>
      )
    } else {
      content = <Search />
    }
  } else if (pathname === '/posts/new' || pathname === '/posts/edit') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to create a post.</p>
          <AuthPanel />
        </div>
      )
    } else {
      const postId = new URLSearchParams(window.location.search).get('id') || undefined
      content = <PostForm session={session} postId={postId} onSaved={() => (window.location.href = '/')} />
    }
  } else if (passwordRecovery) {
    content = <SetNewPasswordForm onDone={() => setPasswordRecovery(false)} />
  } else if (showLogin && !session) {
    content = (
      <div id="landing">
        <section id="pitch">
          <h1>Blogging During Lunch</h1>
          <p className="tagline">Short posts, written on a lunch break.</p>
          <p className="pitch-copy">
            A free technical blogging platform built for professional software
            engineers. Write about what you shipped, what broke, and what you
            learned — no CMS to wrestle with, no paywall, no ads. Just your
            writing.
          </p>
          <ul className="pitch-points">
            <li>Free for individual engineers, no catches</li>
            <li>Built for technical writing — code blocks and all</li>
            <li>Publish in minutes and own what you write</li>
          </ul>
          <button type="button" className="link" onClick={() => setShowLogin(false)}>
            Prefer to just read? View the blog →
          </button>
        </section>
        <section id="auth-panel">
          {disabledNotice && (
            <p className="auth-notice" role="status">
              Your account has been disabled.
            </p>
          )}
          <AuthPanel />
        </section>
      </div>
    )
  } else {
    content = (
      <>
        {session && profile && !profile.avatar_url && !profile.profile_setup_dismissed && (
          <ProfileSetupBanner
            userId={session.user.id}
            onUploaded={(url) => setProfile((p) => ({ ...p, avatar_url: url }))}
            onDismissed={() => setProfile((p) => ({ ...p, profile_setup_dismissed: true }))}
          />
        )}
        <header id="site-header">
          <h1>Blogging During Lunch</h1>
          <p className="tagline">Short posts, written on a lunch break.</p>
        </header>

        {session && authorOrg ? (
          <MyPosts
            organizationId={authorOrg.id}
            organizationName={authorOrg.name}
            organizationSlug={authorOrg.slug}
            viewerRole={authorOrg.role}
          />
        ) : (
          <RecentPosts />
        )}

        <footer id="site-footer">
          <p>&copy; {new Date().getFullYear()} Blogging During Lunch</p>
          {!session && (
            <button type="button" className="link" onClick={() => setShowLogin(true)}>
              Admin login
            </button>
          )}
        </footer>
      </>
    )
  }

  if (session && !passwordRecovery) {
    return (
      <div id="app-shell">
        <NavPane
          userId={session.user.id}
          profile={profile}
          displayName={profile?.display_name}
          email={session.user.email}
          ownedOrg={ownedOrg}
          isSiteAdmin={isSiteAdmin}
          onAvatarUploaded={(url) => setProfile((p) => ({ ...p, avatar_url: url }))}
        />
        <div id="app-content">{content}</div>
      </div>
    )
  }

  return content
}

export default App
