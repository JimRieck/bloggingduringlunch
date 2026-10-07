// User-facing messages for the error codes send-announcement returns.
export function describeSendError(code) {
  switch (code) {
    case 'not_configured':
      return 'Email sending isn’t configured (RESEND_API_KEY is missing).'
    case 'already_sent':
      return 'This announcement has already been sent.'
    case 'empty_announcement':
      return 'Add a subject and a message first.'
    case 'no_recipients':
      return 'Select at least one person to send it to.'
    case 'not_a_site_admin':
    case 'unauthorized':
      return 'Only site admins can send announcements.'
    default:
      return 'Couldn’t send the announcement. Check the sent list below before trying again.'
  }
}

// "Sent to 41 users" / "Sent to 41 of 43 users (2 failed)".
export function describeDelivery({ recipient_count: sent, failed_count: failed }) {
  const total = (sent ?? 0) + (failed ?? 0)
  const users = (n) => `${n} user${n === 1 ? '' : 's'}`
  return failed ? `Sent to ${sent} of ${users(total)} (${failed} failed)` : `Sent to ${users(sent ?? 0)}`
}
