import { describe, expect, it } from 'vitest'
import {
  isLinkedInUnsupportedImage,
  linkedinBlogPostUrl,
  linkedinPostTemplate,
} from '../../src/lib/socialPosting.js'

describe('linkedinBlogPostUrl', () => {
  it('builds the post’s public address, tagged as coming from LinkedIn', () => {
    expect(linkedinBlogPostUrl('https://bloggingduringlunch.com', 'my-blog', 'hello-world')).toBe(
      'https://bloggingduringlunch.com/blog/my-blog/hello-world?utm_source=linkedin',
    )
  })
})

describe('linkedinPostTemplate', () => {
  it('is the title, a blank line, then the link', () => {
    expect(linkedinPostTemplate('Hello world', 'https://x.example/a')).toBe('Hello world\n\nhttps://x.example/a')
  })
})

describe('isLinkedInUnsupportedImage', () => {
  it.each([
    ['https://x.example/a.webp', true],
    ['https://x.example/a.WEBP?v=2', true],
    ['https://x.example/a.png', false],
    ['https://x.example/a.jpg', false],
    [null, false],
  ])('%s -> %s', (url, expected) => {
    expect(isLinkedInUnsupportedImage(url)).toBe(expected)
  })
})
