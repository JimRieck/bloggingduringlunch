import { useState } from 'react'
import { AuthPanel } from './AuthPanel.jsx'
import './LandingNav.css'

const PITCH_COPY =
  'A free technical blogging platform built for professional software engineers. ' +
  'Write about what you shipped, what broke, and what you learned — no CMS to ' +
  'wrestle with, no paywall, no ads. Just your writing.'

const PITCH_POINTS = [
  'Free for individual engineers, no catches',
  'Built for technical writing — code blocks and all',
  'Publish in minutes and own what you write',
]

export function LandingNav({ disabledNotice }) {
  const [activeSection, setActiveSection] = useState(null)

  function toggle(section) {
    setActiveSection((current) => (current === section ? null : section))
  }

  return (
    <nav id="landing-nav">
      <div id="landing-nav-bar">
        <button
          type="button"
          className={activeSection === 'login' ? 'active' : ''}
          aria-expanded={activeSection === 'login'}
          onClick={() => toggle('login')}
        >
          Login
        </button>
        <button
          type="button"
          className={activeSection === 'about' ? 'active' : ''}
          aria-expanded={activeSection === 'about'}
          onClick={() => toggle('about')}
        >
          About
        </button>
      </div>

      {activeSection === 'login' && (
        <div className="landing-nav-panel">
          {disabledNotice && (
            <p className="auth-notice" role="status">
              Your account has been disabled.
            </p>
          )}
          <AuthPanel />
        </div>
      )}

      {activeSection === 'about' && (
        <div className="landing-nav-panel">
          <div className="landing-about">
            <p className="pitch-copy">{PITCH_COPY}</p>
            <ul className="pitch-points">
              {PITCH_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </nav>
  )
}
