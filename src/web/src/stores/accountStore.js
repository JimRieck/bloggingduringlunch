import { create } from 'zustand'

// The signed-in person's own account: their profile, whether they're a
// site admin, and the blogs they belong to.
//
// Memberships are loaded once and kept as the single source of truth;
// the three ways the app asks about them (ownedOrgId, authorOrg,
// orgAdmin) are worked out from that list whenever it changes. Before
// this store, each was its own query and its own copy of the org, so
// renaming a blog had to patch two copies by hand.

// Which of the person's blogs each part of the app needs, from their
// memberships (oldest first). `memberships` is undefined until loaded.
//   ownedOrgId -- the blog they own: invite people to it.
//   authorOrg  -- a blog they can write in (owner or editor): their
//                 posts, importing, social posting. undefined while
//                 loading, null when there's none.
//   orgAdmin   -- a blog they can rename (owner or admin, matching the
//                 organizations RLS policy's is_org_admin).
export function orgsFromMemberships(memberships) {
  if (memberships === undefined) return { ownedOrgId: null, authorOrg: undefined, orgAdmin: null }
  const find = (roles) => memberships.find((m) => roles.includes(m.role))
  const withRole = (m) => (m ? { ...m.organization, role: m.role } : null)
  return {
    ownedOrgId: find(['owner'])?.organization.id ?? null,
    authorOrg: withRole(find(['owner', 'editor'])),
    orgAdmin: withRole(find(['owner', 'admin'])),
  }
}

const signedOut = {
  userId: null,
  profile: null,
  isSiteAdmin: false,
  memberships: undefined,
  ...orgsFromMemberships(undefined),
}

export function createAccountStore(client) {
  return create((set, get) => {
    // The derived org fields are stored alongside the list (not worked
    // out in a selector) so each keeps the same object between updates
    // -- a selector returning a fresh object every time would re-render
    // its component on every store change.
    const setMemberships = (memberships) => set({ memberships, ...orgsFromMemberships(memberships) })

    return {
      ...signedOut,

      async load(userId) {
        set({ ...signedOut, userId })
        const [{ data: profile }, { data: memberships }] = await Promise.all([
          client
            .from('profiles')
            .select('display_name, avatar_url, profile_setup_dismissed, disabled, is_site_admin')
            .eq('id', userId)
            .maybeSingle(),
          client
            .from('memberships')
            .select('role, created_at, organizations(id, name, slug)')
            .eq('user_id', userId)
            .order('created_at'),
        ])
        // Signed out, or someone else signed in, while this was loading.
        if (get().userId !== userId) return

        const { is_site_admin: isSiteAdmin, ...ownProfile } = profile ?? {}
        set({ profile: profile ? ownProfile : null, isSiteAdmin: isSiteAdmin ?? false })
        setMemberships(
          (memberships ?? [])
            .filter((m) => m.organizations)
            .map((m) => ({ role: m.role, organization: m.organizations })),
        )
      },

      clear: () => set(signedOut),

      // The database has already been updated (avatar uploaded, name
      // changed, setup banner dismissed); this keeps the page in step.
      updateProfile: (changes) => set((s) => ({ profile: s.profile && { ...s.profile, ...changes } })),

      renameOrg(orgId, name) {
        const { memberships } = get()
        if (!memberships) return
        setMemberships(
          memberships.map((m) =>
            m.organization.id === orgId ? { ...m, organization: { ...m.organization, name } } : m,
          ),
        )
      },
    }
  })
}
