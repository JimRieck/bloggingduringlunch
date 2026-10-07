import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import { Callout } from './CalloutExtension.js'
import { YoutubeEmbed } from './YoutubeEmbedExtension.js'
import { IsolateSelection } from './IsolateSelectionExtension.js'

// The post editor's Tiptap extensions -- everything EditorToolbar's
// buttons can produce. Shared by every editor that's meant to be "the
// post editor": blog posts (PostForm), LinkedIn posts
// (LinkedInMessageEditor) and email announcements (AnnouncementForm).
export function postEditorExtensions() {
  return [StarterKit, Link.configure({ openOnClick: false }), Image, Underline, Callout, YoutubeEmbed, IsolateSelection]
}
