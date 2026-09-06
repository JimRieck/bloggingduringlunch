# Blogging During Lunch

See [ROADMAP.md](ROADMAP.md) for current build status, architecture, and what's done vs. open.

## Mobile support is a requirement, not an afterthought

This site must work on real phones — as far back as a Galaxy S21 and the
equivalent-era iPhone (2021). When adding or changing UI:

- Before calling a UI change done, check it at a phone-width viewport (e.g.
  384×854) in addition to desktop. Use the Browser pane's `resize_window`
  tool — no physical device needed for the vast majority of issues.
- Any fixed/sticky sidebar or overlay needs an explicit mobile treatment
  (off-canvas drawer, stacked layout, etc.) — don't let a desktop pattern
  just "shrink" onto a phone screen and call it responsive.
- Interactive elements (buttons, links, icon actions) need touch targets of
  roughly 40–44px, not just enough room for a mouse cursor.
- A `position: fixed` element nested inside an ancestor with a `transform`
  (e.g. a sliding drawer) will be confined to that ancestor's box instead of
  the viewport — this bit us once (`NavPane`'s profile-photo modal). Render
  fixed-position overlays/modals as siblings of transformed containers, not
  descendants of them.
- The breakpoint used across this codebase for "phone-sized" is
  `max-width: 768px`; `max-width: 1024px` is used for the looser
  tablet/narrow-desktop breakpoints on the marketing landing page.
