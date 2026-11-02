// The app's shared state, as Zustand stores bound to the app's Supabase
// client. Only state that several screens share lives here (who's signed
// in, their account, feature flags) -- form fields, the editor and each
// page's own data stay in their components.
//
// Read with a selector, so a component only re-renders when the part it
// uses changes:
//   const isSiteAdmin = useAccountStore((s) => s.isSiteAdmin)
// Call actions outside rendering through getState():
//   useAccountStore.getState().updateProfile({ avatar_url: url })
import { supabase } from '../lib/supabaseClient.js'
import { createAccountStore } from './accountStore.js'
import { createAuthStore } from './authStore.js'
import { createFeatureFlagsStore } from './featureFlagsStore.js'

export const useAuthStore = createAuthStore(supabase)
export const useAccountStore = createAccountStore(supabase)
export const useFeatureFlagsStore = createFeatureFlagsStore(supabase)

// The current session, or null when signed out.
export const useSession = () => useAuthStore((s) => s.session)
