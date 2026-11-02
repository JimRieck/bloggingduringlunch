import { describe, expect, it } from 'vitest'
import { orgsFromMemberships } from '../../src/stores/accountStore.js'

const blog = (id) => ({ id, name: `Blog ${id}`, slug: `blog-${id}` })

describe('orgsFromMemberships', () => {
  it('is "still loading" before memberships arrive', () => {
    expect(orgsFromMemberships(undefined)).toEqual({ ownedOrgId: null, authorOrg: undefined, orgAdmin: null })
  })

  it('is "none" for someone with no blogs', () => {
    expect(orgsFromMemberships([])).toEqual({ ownedOrgId: null, authorOrg: null, orgAdmin: null })
  })

  it('an owner can invite, write and rename', () => {
    expect(orgsFromMemberships([{ role: 'owner', organization: blog(1) }])).toEqual({
      ownedOrgId: 1,
      authorOrg: { ...blog(1), role: 'owner' },
      orgAdmin: { ...blog(1), role: 'owner' },
    })
  })

  it('an editor can write but not invite or rename', () => {
    expect(orgsFromMemberships([{ role: 'editor', organization: blog(1) }])).toEqual({
      ownedOrgId: null,
      authorOrg: { ...blog(1), role: 'editor' },
      orgAdmin: null,
    })
  })

  it('an admin can rename but not write or invite', () => {
    expect(orgsFromMemberships([{ role: 'admin', organization: blog(1) }])).toEqual({
      ownedOrgId: null,
      authorOrg: null,
      orgAdmin: { ...blog(1), role: 'admin' },
    })
  })

  it('across several blogs, each question takes the first (oldest) membership that answers it', () => {
    const result = orgsFromMemberships([
      { role: 'editor', organization: blog(1) },
      { role: 'admin', organization: blog(2) },
      { role: 'owner', organization: blog(3) },
    ])
    expect(result.authorOrg.id).toBe(1)
    expect(result.orgAdmin.id).toBe(2)
    expect(result.ownedOrgId).toBe(3)
  })
})
