-- A short, author-written description of a post (150 characters max),
-- for sharing: the description on its LinkedIn card and in the "What to
-- say" template on /social, and the og:description in link previews
-- (api/og.js). Optional -- without one, those fall back to the start of
-- the post body as before. Covered by the existing posts policies and
-- grants, like every other post column.
alter table public.posts
  add column description text check (description is null or char_length(description) <= 150);
