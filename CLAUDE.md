# Blogging During Lunch

See [ROADMAP.md](ROADMAP.md) for current build status, architecture, and what's done vs. open.

## Two-factor authentication is required for every account

A logged-in session only works after the authenticator code step ("aal2").
The database rejects anything less (`public.enforce_mfa`, run before every
API request), so when adding code:

- New Edge Functions identify the caller with `getCaller` from
  `supabase/functions/_shared/auth.ts` (it rejects password-only tokens),
  never a bare `auth.getUser()`.
- Integration tests create users through `confirmSignup` and log back in
  with `signInWithMfa` (`src/web/tests/helpers/testClients.js`); a plain
  `signInWithPassword` client gets `403 mfa_required` from the database.

## New tables need explicit grants

Supabase no longer gives new tables or views in `public` any Data API
access automatically (`20261020120000_explicit_data_api_grants.sql`
switched it off ahead of Supabase's 2026-10-30 change). A table without
grants is unreachable through supabase-js — "permission denied", even
for the Edge Functions' `service_role`. So the migration that creates a
table or view must also grant exactly what's needed, e.g.:

```sql
grant select on public.my_table to anon;                                     -- only if readers need it
grant select, insert, update, delete on public.my_table to authenticated;    -- narrow to what the app uses
grant select, insert, update, delete on public.my_table to service_role;     -- always, for Edge Functions
```

RLS still decides which rows each role can touch; grants only open the
door. Functions are unaffected.

## Dates and days are Eastern time

The site runs on Eastern time (America/New_York, EST/EDT). Never split
time into days with UTC:

- In SQL, a day runs from `public.site_day_start(d)` to
  `public.site_day_start(d + 1)` -- don't compare a timestamp with a plain
  `date` (that's midnight UTC).
- In the app, use `src/web/src/lib/siteTime.js` for "today", date ranges
  (`siteDateDaysAgo`) and showing dates/times (`formatSiteDate`,
  `formatSiteDateTime`), never `toISOString().slice(0, 10)` or a bare
  `toLocaleDateString()`.

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
