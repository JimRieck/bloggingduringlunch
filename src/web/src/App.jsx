import { useEffect, useState } from 'react'
import './App.css'
import { AuthPanel } from './components/AuthPanel.jsx'
import { SetNewPasswordForm } from './components/SetNewPasswordForm.jsx'
import { NavPane } from './components/NavPane.jsx'
import { ProfileSetupBanner } from './components/ProfileSetupBanner.jsx'
import { PostForm } from './components/PostForm.jsx'
import { MyPosts } from './components/MyPosts.jsx'
import { TenantBlog } from './components/TenantBlog.jsx'
import { UserDirectory } from './components/UserDirectory.jsx'
import { supabase } from './lib/supabaseClient.js'
import { getTenantSlugFromHostname } from './lib/tenant.js'

const posts = [
  {
    slug: 'hello-world',
    title: 'Hello, world',
    date: '2026-08-31',
    excerpt:
      'First post. This is where the lunch-break writing starts — short posts, no pressure to be polished.',
  },
]

function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function App() {
  const tenantSlug = getTenantSlugFromHostname()
  const [showLogin, setShowLogin] = useState(true)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [ownedOrg, setOwnedOrg] = useState(null)
  const [authorOrg, setAuthorOrg] = useState(undefined)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('profiles')
      .select('display_name, avatar_url, profile_setup_dismissed')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  useEffect(() => {
    if (!session) return
    supabase
      .from('memberships')
      .select('organizations(name, invite_code)')
      .eq('user_id', session.user.id)
      .eq('role', 'owner')
      .maybeSingle()
      .then(({ data }) => setOwnedOrg(data?.organizations ?? null))
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

  if (tenantSlug) {
    return <TenantBlog slug={tenantSlug} />
  }

  const pathname = window.location.pathname

  if (pathname.startsWith('/blog/')) {
    return <TenantBlog slug={pathname.slice('/blog/'.length)} />
  }

  let content
  if (pathname === '/directory') {
    content = <UserDirectory session={session} />
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
          <main id="posts">
            {posts.map((post) => (
              <article className="post-summary" key={post.slug}>
                <h2>
                  <a href={`/posts/${post.slug}`}>{post.title}</a>
                </h2>
                <time dateTime={post.date}>{formatDate(post.date)}</time>
                <p>{post.excerpt}</p>
              </article>
            ))}
          </main>
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
          onAvatarUploaded={(url) => setProfile((p) => ({ ...p, avatar_url: url }))}
        />
        <div id="app-content">{content}</div>
      </div>
    )
  }

  return content
}

export default App
