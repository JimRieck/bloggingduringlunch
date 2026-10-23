import { formatSiteTime } from '../lib/siteTime.js'

// The quiet line next to the editor's buttons saying where auto-save is.
// `pending` means saves go to the private pending copy of a published
// post rather than the post itself.
export function AutoSaveStatus({ status, pending }) {
  const time = status.savedAt ? formatSiteTime(status.savedAt) : null
  let text
  switch (status.state) {
    case 'saving':
      text = 'Saving…'
      break
    case 'error':
      text = 'Couldn’t save — retrying'
      break
    case 'conflict':
      text =
        'Auto-save paused: this post was changed somewhere else (another tab, or another editor). Reload to see the latest, or Save/Publish to keep your version.'
      break
    case 'saved':
      text = pending ? `Changes saved privately at ${time} — not live until you publish` : `Draft saved ${time}`
      break
    default:
      text = pending ? 'Changes save automatically and stay private until you publish' : 'Saves automatically'
  }
  return (
    <p className={`autosave-status autosave-${status.state}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}
