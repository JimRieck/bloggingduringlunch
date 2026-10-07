import { useState } from 'react'

// Who an announcement goes to: every active user, each with a checkbox,
// all ticked unless unchecked on this draft. Works in terms of the
// unchecked ids, since that's what's saved (see excluded_user_ids).
export function AnnouncementRecipients({ recipients, excludedIds, onChange }) {
  const [filter, setFilter] = useState('')

  const selectedCount = recipients.filter((r) => !excludedIds.has(r.user_id)).length
  const term = filter.trim().toLowerCase()
  const shown = term
    ? recipients.filter((r) => `${r.display_name ?? ''} ${r.email}`.toLowerCase().includes(term))
    : recipients

  function toggle(userId) {
    const next = new Set(excludedIds)
    if (next.has(userId)) next.delete(userId)
    else next.add(userId)
    onChange(next)
  }

  return (
    <fieldset className="announcement-recipients">
      <legend>Send to</legend>
      <div className="recipients-toolbar">
        <span className="recipients-count" role="status">
          {selectedCount} of {recipients.length} selected
        </span>
        <button type="button" className="link" onClick={() => onChange(new Set())}>
          Select all
        </button>
        <button
          type="button"
          className="link"
          onClick={() => onChange(new Set(recipients.map((r) => r.user_id)))}
        >
          Select none
        </button>
      </div>
      {recipients.length > 8 && (
        <input
          type="search"
          className="recipients-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or email"
          aria-label="Filter recipients"
        />
      )}
      <ul className="recipients-list">
        {shown.map((r) => (
          <li key={r.user_id}>
            <label>
              <input type="checkbox" checked={!excludedIds.has(r.user_id)} onChange={() => toggle(r.user_id)} />
              <span className="recipient-name">{r.display_name || r.email}</span>
              {r.display_name && <span className="recipient-email">{r.email}</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="recipients-none">No one matches “{filter}”.</li>}
      </ul>
    </fieldset>
  )
}
