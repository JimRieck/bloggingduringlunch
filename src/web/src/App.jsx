import { useEffect } from 'react'
import './App.css'
import { AdminPanel } from './components/AdminPanel.jsx'
import { AnnouncementsAdmin } from './components/AnnouncementsAdmin.jsx'
import { AuthPanel } from './components/AuthPanel.jsx'
import { SetNewPasswordForm } from './components/SetNewPasswordForm.jsx'
import { BulkAutoTag } from './components/BulkAutoTag.jsx'
import { ImportFromWordPress } from './components/ImportFromWordPress.jsx'
import { LandingNav } from './components/LandingNav.jsx'
import { MfaChallenge } from './components/MfaChallenge.jsx'
import { MfaSetup } from './components/MfaSetup.jsx'
import { NavPane } from './components/NavPane.jsx'
import { ProfileSetupBanner } from './components/ProfileSetupBanner.jsx'
import { PostForm } from './components/PostForm.jsx'
import { PostPreview } from './components/PostPreview.jsx'
import { MyPosts } from './components/MyPosts.jsx'
import { RecentPosts } from './components/RecentPosts.jsx'
import { Search } from './components/Search.jsx'
import { SearchBox } from './components/SearchBox.jsx'
import { SocialPosting } from './components/SocialPosting.jsx'
import { SuggestionBox } from './components/SuggestionBox.jsx'
import { TenantBlog } from './components/TenantBlog.jsx'
import { UserDirectory } from './components/UserDirectory.jsx'
import { getTenantSlugFromHostname } from './lib/tenant.js'
import { mfaStep } from './lib/mfa.js'
import { useAccountStore, useAuthStore } from './stores/index.js'

function App() {
  const tenantSlug = getTenantSlugFromHostname()
  const session = useAuthStore((s) => s.session)
  const passwordRecovery = useAuthStore((s) => s.passwordRecovery)
  const disabledNotice = useAuthStore((s) => s.disabledNotice)
  const profile = useAccountStore((s) => s.profile)
  const authorOrg = useAccountStore((s) => s.authorOrg)
  const isSiteAdmin = useAccountStore((s) => s.isSiteAdmin)
  // Only once two-factor is done -- before that the database refuses
  // every request, so there's no account to load yet. The id rather than
  // the session object, which is replaced on every hourly token refresh.
  const signedInUserId = session && !mfaStep(session) ? session.user.id : null

  useEffect(() => useAuthStore.getState().start(), [])

  useEffect(() => {
    const account = useAccountStore.getState()
    if (signedInUserId) account.load(signedInUserId)
    else account.clear()
  }, [signedInUserId])

  useEffect(() => {
    if (profile?.disabled) useAuthStore.getState().signOutDisabled()
  }, [profile])

  const pathname = window.location.pathname

  // Two-factor is required for every account: until the authenticator
  // code is entered, a password-only login sees nothing else -- the
  // database refuses its requests anyway. Comes before the password
  // reset screen too, because Supabase won't change the password of an
  // account with an authenticator until the code has been entered.
  const step = mfaStep(session)
  if (step === 'setup') return <MfaSetup />
  if (step === 'challenge') return <MfaChallenge />

  if (tenantSlug) {
    const postSlug = pathname.slice(1) || undefined
    return <TenantBlog slug={tenantSlug} postSlug={postSlug} />
  }

  if (pathname.startsWith('/blog/')) {
    const [orgSlug, postSlug] = pathname.slice('/blog/'.length).split('/')
    return <TenantBlog slug={orgSlug} postSlug={postSlug || undefined} />
  }

  // Rendered bare, like the published blog above, not inside the app
  // shell -- it's showing what readers will see.
  if (pathname === '/posts/preview') {
    return <PostPreview previewId={new URLSearchParams(window.location.search).get('id')} />
  }

  let content
  if (pathname === '/directory') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to access the user directory.</p>
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
      content = <UserDirectory />
    }
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
      content = <AdminPanel />
    }
  } else if (pathname === '/admin/announcements') {
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
      content = <AnnouncementsAdmin />
    }
  } else if (pathname === '/social') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to schedule social posts.</p>
          <AuthPanel />
        </div>
      )
    } else {
      content = <SocialPosting />
    }
  } else if (pathname === '/suggestions') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to submit a suggestion.</p>
          <AuthPanel />
        </div>
      )
    } else {
      content = <SuggestionBox />
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
      content = <PostForm postId={postId} onSaved={() => (window.location.href = '/')} />
    }
  } else if (pathname === '/posts/import') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to import posts.</p>
          <AuthPanel />
        </div>
      )
    } else {
      content = <ImportFromWordPress />
    }
  } else if (pathname === '/posts/bulk-tag') {
    if (!session) {
      content = (
        <div id="directory-gate">
          <p>Log in to auto-tag posts.</p>
          <AuthPanel />
        </div>
      )
    } else {
      content = <BulkAutoTag />
    }
  } else if (passwordRecovery) {
    content = <SetNewPasswordForm onDone={() => useAuthStore.getState().finishPasswordRecovery()} />
  } else if (!session) {
    content = (
      <>
        <LandingNav disabledNotice={disabledNotice} />
        <header id="site-header">
          <h1>
            <img src="/images/bdl_logo.jpg" alt="Blogging During Lunch" className="site-logo" />
          </h1>
          <p className="tagline">Short posts, written on a lunch break.</p>
        </header>
        <main id="landing-search">
          <SearchBox wide />
        </main>
        <footer id="site-footer">
          <p>&copy; {new Date().getFullYear()} Blogging During Lunch</p>
        </footer>
      </>
    )
  } else {
    content = (
      <>
        {profile && !profile.avatar_url && !profile.profile_setup_dismissed && (
          <ProfileSetupBanner
            userId={session.user.id}
            onUploaded={(url) => useAccountStore.getState().updateProfile({ avatar_url: url })}
            onDismissed={() => useAccountStore.getState().updateProfile({ profile_setup_dismissed: true })}
          />
        )}
        <header id="site-header">
          <h1>
            <img src="/images/bdl_logo.jpg" alt="Blogging During Lunch" className="site-logo" />
          </h1>
          <p className="tagline">Short posts, written on a lunch break.</p>
        </header>

        {authorOrg ? (
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
        </footer>
      </>
    )
  }

  if (session && !passwordRecovery) {
    return (
      <div id="app-shell">
        <NavPane />
        <div id="app-content">{content}</div>
      </div>
    )
  }

  return content
}

export default App
