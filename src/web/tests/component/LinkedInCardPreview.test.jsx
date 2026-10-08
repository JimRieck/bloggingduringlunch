// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LinkedInCardPreview } from '../../src/components/LinkedInCardPreview.jsx'

afterEach(cleanup)

const post = {
  id: 'p1',
  title: 'Shipping during lunch',
  thumbnailUrl: 'https://abc.supabase.co/storage/v1/object/public/post-images/org/pic.png',
  url: 'https://bloggingduringlunch.com/blog/my-blog/shipping?utm_source=linkedin',
}

describe('LinkedInCardPreview', () => {
  it('shows the thumbnail with the title and the site’s address beside it', () => {
    const { container } = render(<LinkedInCardPreview post={post} />)
    expect(container.querySelector('img.linkedin-card-image')).toHaveAttribute('src', post.thumbnailUrl)
    expect(screen.getByText('Shipping during lunch')).toBeInTheDocument()
    expect(screen.getByText('bloggingduringlunch.com')).toBeInTheDocument()
  })

  it('says so when the post has no thumbnail', () => {
    const { container } = render(<LinkedInCardPreview post={{ ...post, thumbnailUrl: null }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/no thumbnail/)).toBeInTheDocument()
  })

  it('warns that a WebP thumbnail won’t appear on LinkedIn, and leaves it off the preview', () => {
    const { container } = render(<LinkedInCardPreview post={{ ...post, thumbnailUrl: 'https://x.example/pic.webp' }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/WebP image, which LinkedIn doesn’t accept/)).toBeInTheDocument()
  })
})
