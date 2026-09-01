import { useState } from 'react'
import { LoginForm } from './LoginForm.jsx'
import { RegisterForm } from './RegisterForm.jsx'
import { ForgotPasswordForm } from './ForgotPasswordForm.jsx'
import './auth.css'

export function AuthPanel() {
  const [view, setView] = useState('login')

  return (
    <div className="auth-card">
      {view === 'login' && <LoginForm onSwitch={setView} />}
      {view === 'register' && <RegisterForm onSwitch={setView} />}
      {view === 'forgot' && <ForgotPasswordForm onSwitch={setView} />}
    </div>
  )
}
