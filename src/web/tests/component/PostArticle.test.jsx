// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostArticle } from '../../src/components/PostArticle.jsx'

const basePost = {
  title: 'Shipping During Lunch',
  content: '<p>Hello <strong>world</strong></p>',
  published_at: '2026-10-01T12:00:00Z',
  thumbnail_url: null,
  categories: [],
  tags: [],
}

describe('PostArticle', () => {
  it('renders the title, the date and the formatted body', () => {
    const { container } = render(<PostArticle post={basePost} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Shipping During Lunch' })).toBeInTheDocument()
    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T12:00:00Z')
    expect(container.querySelector('.post-body strong')).toHaveTextContent('world')
  })

  it('links the title only when given a titleHref', () => {
    const { rerender } = render(<PostArticle post={basePost} />)
    expect(screen.queryByRole('link')).toBeNull()

    rerender(<PostArticle post={basePost} titleHref="/blog/my-org/shipping" />)
    expect(screen.getByRole('link', { name: 'Shipping During Lunch' })).toHaveAttribute('href', '/blog/my-org/shipping')
  })

  it('shows the thumbnail only when the post has one', () => {
    const { container, rerender } = render(<PostArticle post={basePost} />)
    expect(container.querySelector('.post-thumbnail')).toBeNull()

    rerender(<PostArticle post={{ ...basePost, thumbnail_url: 'https://example.com/hero.png' }} />)
    expect(container.querySelector('.post-thumbnail')).toHaveAttribute('src', 'https://example.com/hero.png')
  })

  it('shows categories as badges and tags with a leading #, and no badge row at all when there are neither', () => {
    const { container, rerender } = render(<PostArticle post={basePost} />)
    expect(container.querySelector('.post-taxonomy')).toBeNull()

    rerender(<PostArticle post={{ ...basePost, categories: ['Engineering'], tags: ['postgres'] }} />)
    expect(screen.getByText('Engineering')).toHaveClass('post-category-badge')
    expect(screen.getByText('#postgres')).toHaveClass('post-tag-badge')
  })

  it('strips script tags and inline event handlers from the body', () => {
    const content = '<p onclick="alert(1)">Safe text</p><script>window.hacked = true</script>'
    const { container } = render(<PostArticle post={{ ...basePost, content }} />)
    const body = container.querySelector('.post-body')
    expect(body).toHaveTextContent('Safe text')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('p')).not.toHaveAttribute('onclick')
  })

  it('turns a YouTube embed placeholder into a real player iframe', () => {
    const content = '<div data-type="youtube-embed" data-video-id="dQw4w9WgXcQ"></div>'
    const { container } = render(<PostArticle post={{ ...basePost, content }} />)
    const iframe = container.querySelector('.post-body iframe')
    expect(iframe).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('leaves a placeholder with a malformed video id alone', () => {
    const content = '<div data-type="youtube-embed" data-video-id="../../evil?x=1"></div>'
    const { container } = render(<PostArticle post={{ ...basePost, content }} />)
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('renders children after the body', () => {
    render(
      <PostArticle post={basePost}>
        <p>Comments go here</p>
      </PostArticle>,
    )
    expect(screen.getByText('Comments go here')).toBeInTheDocument()
  })
})
