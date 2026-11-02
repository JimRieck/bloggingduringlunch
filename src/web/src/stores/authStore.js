import { create } from 'zustand'

// Who's signed in, for every screen that needs to know -- this replaces
// the `session` prop App.jsx used to hand down to a dozen components.
//
// A factory taking the Supabase client, rather than one store built at
// import time, so tests can run it against a real local client; the
// app's own instance lives in stores/index.js.
export function createAuthStore(client) {
  return create((set) => ({
    session: null,
    // A password-reset or invite link was followed: "set a new password"
    // comes next, whatever page it landed on.
    passwordRecovery: false,
    // Shown on the landing page once a disabled account has been signed
    // out (see signOutDisabled).
    disabledNotice: false,

    // Follows Supabase's auth state from now on. Returns the
    // unsubscribe, so it fits straight into a useEffect.
    start() {
      client.auth.getSession().then(({ data: { session } }) => set({ session }))
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((event, session) => {
        set({ session })
        if (event === 'PASSWORD_RECOVERY') set({ passwordRecovery: true })
        // supabase-js has no distinct INVITE event -- an admin-generated
        // invite link fires plain SIGNED_IN, so a `?invited=1` marker on
        // the invite email's redirectTo is how we detect "this login
        // needs to set a password," same as a real recovery link.
        if (event === 'SIGNED_IN' && new URLSearchParams(window.location.search).get('invited') === '1') {
          set({ passwordRecovery: true })
          window.history.replaceState({}, '', window.location.pathname)
        }
      })
      return () => subscription.unsubscribe()
    },

    finishPasswordRecovery: () => set({ passwordRecovery: false }),

    // Auth-level bans (see AdminPanel.jsx) block new logins/refreshes
    // immediately but don't revoke an already-issued access token, so an
    // already-open session could otherwise keep working for up to an
    // hour. App.jsx calls this as soon as the profile says "disabled".
    async signOutDisabled() {
      await client.auth.signOut()
      set({ disabledNotice: true })
    },
  }))
}
