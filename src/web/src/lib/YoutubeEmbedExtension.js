import { Node, mergeAttributes } from '@tiptap/core'

// Same trick as CalloutExtension.js: what actually gets stored (and what
// TenantBlog.jsx sanitizes) is a boring `<div data-type="youtube-embed"
// data-video-id="...">` -- div, class, and data-* attributes all pass
// DOMPurify's default allow-list untouched, so this needs zero sanitizer
// config changes anywhere. The real `<iframe>` only ever exists in two
// places that never go through `dangerouslySetInnerHTML`: this node's
// own editor NodeView below, and TenantBlog.jsx's post-sanitize
// hydration effect (which rebuilds it via document.createElement, not
// by trusting sanitizer-approved HTML).
export const YoutubeEmbed = Node.create({
  name: 'youtubeEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      videoId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-video-id'),
        renderHTML: (attributes) => ({ 'data-video-id': attributes.videoId }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="youtube-embed"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'youtube-embed', class: 'youtube-embed-placeholder' }),
    ]
  },

  addNodeView() {
    return ({ node }) => {
      const wrapper = document.createElement('div')
      wrapper.setAttribute('data-type', 'youtube-embed')
      wrapper.className = 'youtube-embed-wrapper'
      const iframe = document.createElement('iframe')
      iframe.src = `https://www.youtube-nocookie.com/embed/${node.attrs.videoId}`
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'
      iframe.allowFullscreen = true
      iframe.frameBorder = '0'
      wrapper.appendChild(iframe)
      return { dom: wrapper }
    }
  },
})
