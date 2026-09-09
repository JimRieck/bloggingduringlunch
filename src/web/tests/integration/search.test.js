// Integration tests against a real local Supabase stack -- see
// signup.test.js for the pattern this follows.
//
// Search.jsx itself is just three parallel ilike queries plus a
// client-side join (see that file); what's actually worth regression
// coverage is that each of those queries returns the right rows under
// real RLS -- especially that an unauthenticated/other-org searcher
// can find published content at all, and that a draft never leaks
// into results just because its title matches.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupTestData, confirmSignup, createTestClient } from '../helpers/testClients.js'

const runId = crypto.randomUUID().slice(0, 8)
const emailFor = (name) => `${name}.${runId}@example.com`
const PASSWORD = 'password123'

const createdUserIds = []
const createdOrgIds = []

async function signUp(client, email, data) {
  const { data: result, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data },
  })
  if (error) throw error
  createdUserIds.push(result.user.id)
  // signUp() no longer returns a session directly (enable_confirmations
  // is on) -- this completes the same confirmation-email flow a real
  // user's click does, via the real email Supabase sent to Mailpit.
  return confirmSignup(client, email)
}

describe('search: authors, blogs, and posts', () => {
  afterAll(() => cleanupTestData(createdOrgIds, createdUserIds))

  const orgName = `Searchable Widgets ${runId}`
  const authorName = `Searchtest Author ${runId}`
  const publishedTitle = `Findable Published Post ${runId}`
  const draftTitle = `Findable Draft Post ${runId}`

  let authorClient
  let orgId
  let searcherClient

  beforeAll(async () => {
    authorClient = createTestClient()
    const { user } = await signUp(authorClient, emailFor('search-author'), {
      username: authorName,
      user_type: 'author',
      new_organization_name: orgName,
    })

    const { data: membership } = await authorClient
      .from('memberships')
      .select('organizations(id)')
      .eq('user_id', user.id)
      .single()
    orgId = membership.organizations.id
    createdOrgIds.push(orgId)

    await authorClient.from('posts').insert([
      {
        organization_id: orgId,
        author_id: user.id,
        title: publishedTitle,
        content: '<p>content</p>',
        status: 'published',
        published_at: new Date().toISOString(),
      },
      {
        organization_id: orgId,
        author_id: user.id,
        title: draftTitle,
        content: '<p>content</p>',
        status: 'draft',
        published_at: null,
      },
    ])

    // A different, unrelated account -- proves search works across org
    // boundaries, not just for the author searching their own content.
    searcherClient = createTestClient()
    await signUp(searcherClient, emailFor('searcher'), {
      username: 'searcher-' + runId,
      user_type: 'reader',
    })
  })

  it('finds an author by display name', async () => {
    const { data, error } = await searcherClient
      .from('user_directory')
      .select('id, display_name, organizations')
      .eq('user_type', 'author')
      .ilike('display_name', `%${authorName}%`)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].organizations).toBe(orgName)
  })

  it('finds a blog by org name', async () => {
    const { data, error } = await searcherClient
      .from('organizations_public')
      .select('id, name, slug')
      .ilike('name', `%${orgName}%`)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe(orgId)
  })

  it('finds a published post by title, from a completely different account', async () => {
    const { data, error } = await searcherClient
      .from('posts')
      .select('id, title, organization_id')
      .eq('status', 'published')
      .ilike('title', `%${publishedTitle}%`)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].organization_id).toBe(orgId)
  })

  it("never returns a draft, even when its title matches", async () => {
    const { data, error } = await searcherClient
      .from('posts')
      .select('id, title')
      .eq('status', 'published')
      .ilike('title', `%${draftTitle}%`)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('returns nothing for a term nobody matches', async () => {
    const nonsense = `zzz-no-match-${runId}`
    const [authors, orgs, posts] = await Promise.all([
      searcherClient.from('user_directory').select('id').ilike('display_name', `%${nonsense}%`),
      searcherClient.from('organizations_public').select('id').ilike('name', `%${nonsense}%`),
      searcherClient.from('posts').select('id').eq('status', 'published').ilike('title', `%${nonsense}%`),
    ])
    expect(authors.data).toHaveLength(0)
    expect(orgs.data).toHaveLength(0)
    expect(posts.data).toHaveLength(0)
  })
})
