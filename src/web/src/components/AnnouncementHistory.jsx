import { useState } from 'react'
import { describeDelivery } from '../lib/announcements.js'

// Announcements that have gone out, newest first. "View" shows the email
// exactly as recipients got it, in a sandboxed frame so its own styles
// can't leak into (or be affected by) the admin page.
export function AnnouncementHistory({ announcements, senderNames }) {
  const [openId, setOpenId] = useState(null)

  if (announcements.length === 0) {
    return <p className="announcement-empty">Nothing sent yet.</p>
  }

  return (
    <ul className="announcement-list">
      {announcements.map((a) => (
        <li key={a.id} className="announcement-row">
          <div className="announcement-row-main">
            <div className="announcement-subject">{a.subject}</div>
            <div className="announcement-meta">
              {a.status === 'sending'
                ? 'Sending… (if this doesn’t change after a few minutes, the send was interrupted)'
                : `${new Date(a.sent_at).toLocaleString()} · ${describeDelivery(a)}`}
              {senderNames[a.sent_by] && <> · by {senderNames[a.sent_by]}</>}
            </div>
          </div>
          <button
            type="button"
            className="announcement-row-action"
            aria-expanded={openId === a.id}
            onClick={() => setOpenId(openId === a.id ? null : a.id)}
          >
            {openId === a.id ? 'Hide' : 'View'}
          </button>
          {openId === a.id && (
            <iframe className="announcement-preview" title={`Email: ${a.subject}`} sandbox="" srcDoc={a.email_html} />
          )}
        </li>
      ))}
    </ul>
  )
}
