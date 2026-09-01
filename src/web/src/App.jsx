import { useEffect, useState } from 'react'
import './App.css'
import { AuthPanel } from './components/AuthPanel.jsx'
import { SetNewPasswordForm } from './components/SetNewPasswordForm.jsx'
import { Avatar } from './components/Avatar.jsx'
import { TenantBlog } from './components/TenantBlog.jsx'
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
      .select('avatar_url')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (tenantSlug) {
    return <TenantBlog slug={tenantSlug} />
  }

  if (passwordRecovery) {
    return <SetNewPasswordForm onDone={() => setPasswordRecovery(false)} />
  }

  if (showLogin && !session) {
    return (
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
  }

  return (
    <>
      {session && (
        <div id="user-bar">
          <Avatar url={profile?.avatar_url} label={session.user.email} />
        </div>
      )}
      <header id="site-header">
        <h1>Blogging During Lunch</h1>
        <p className="tagline">Short posts, written on a lunch break.</p>
      </header>

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

      <footer id="site-footer">
        <p>&copy; {new Date().getFullYear()} Blogging During Lunch</p>
        {session ? (
          <>
            <span className="session-email">{session.user.email}</span>
            <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
              Log out
            </button>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setShowLogin(true)}>
            Admin login
          </button>
        )}
      </footer>
    </>
  )
}

export default App
