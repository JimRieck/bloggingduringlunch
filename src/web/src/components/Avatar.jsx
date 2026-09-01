import './Avatar.css'

export function Avatar({ url, label }) {
  if (url) {
    return <img src={url} alt="" className="avatar" />
  }

  const initial = (label || '?').trim().charAt(0).toUpperCase()
  return (
    <span className="avatar avatar-fallback" aria-hidden="true">
      {initial}
    </span>
  )
}
