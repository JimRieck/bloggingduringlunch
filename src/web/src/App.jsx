import { useState } from 'react'
import './App.css'
import Login from './Login.jsx'

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
  const [showLogin, setShowLogin] = useState(false)

  if (showLogin) {
    return <Login onBack={() => setShowLogin(false)} />
  }

  return (
    <>
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
        <button type="button" className="link" onClick={() => setShowLogin(true)}>
          Admin login
        </button>
      </footer>
    </>
  )
}

export default App
