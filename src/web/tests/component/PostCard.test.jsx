// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PostCard } from '../../src/components/PostCard.jsx'
import '@testing-library/jest-dom/vitest'

afterEach(cleanup)

const post = {
  title: 'Shipping During Lunch',
  description: null,
  published_at: '2026-10-01T12:00:00Z',
  thumbnail_url: null,
  organization: { name: 'My Blog' },
  author: { display_name: 'Pat', avatar_url: null },
}

describe('PostCard', () => {
  it('shows the post’s description under its title', () => {
    const { container } = render(
      <PostCard post={{ ...post, description: 'Why I ship on my lunch break.' }} href="/blog/my-blog/shipping" />,
    )
    const description = container.querySelector('.post-card-description')
    expect(description).toHaveTextContent('Why I ship on my lunch break.')
    expect(description.previousElementSibling).toHaveTextContent('Shipping During Lunch')
  })

  it('shows nothing extra for a post without one', () => {
    const { container } = render(<PostCard post={post} href="/blog/my-blog/shipping" />)
    expect(container.querySelector('.post-card-description')).toBeNull()
    expect(screen.getByRole('link', { name: 'Shipping During Lunch' })).toBeInTheDocument()
  })
})
