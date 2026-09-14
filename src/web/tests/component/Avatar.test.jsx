// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from '../../src/components/Avatar.jsx'

describe('Avatar', () => {
  it('renders the image when a url is given', () => {
    const { container } = render(<Avatar url="https://example.com/pic.png" label="Jane Doe" />)
    // Not queried via getByRole('img') -- alt="" is deliberate (see
    // below) and correctly strips the implicit img role, so an
    // accessibility-aware query wouldn't find it either; that's the
    // point being tested, not a reason to query around it.
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.com/pic.png')
    // Decorative when a label exists elsewhere alongside it (every
    // real usage in this app renders a name/title next to the
    // avatar) -- an empty alt avoids a screen reader reading a raw
    // URL or a redundant name twice.
    expect(img).toHaveAttribute('alt', '')
  })

  it('falls back to the uppercased first letter of the label when there is no url', () => {
    render(<Avatar url={null} label="jane doe" />)
    expect(screen.getByText('J')).toBeInTheDocument()
  })

  it('trims leading whitespace before taking the first letter', () => {
    render(<Avatar url={null} label="  Zed" />)
    expect(screen.getByText('Z')).toBeInTheDocument()
  })

  it('falls back to "?" when there is no url and no usable label', () => {
    render(<Avatar url={null} label="" />)
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
