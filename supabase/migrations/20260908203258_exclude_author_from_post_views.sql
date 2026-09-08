-- The original insert policy let a post's own author record views on
-- their own post like anyone else, which means the author could
-- trivially inflate their own view count just by reloading the page.
-- Enforced here (not just skipped client-side in TenantBlog.jsx) so it
-- can't be worked around by calling the insert directly.
--
-- No security-definer helper needed: this subquery only ever runs
-- against status='published' rows, which the existing posts select
-- policy already makes visible to everyone (anon included) -- unlike
-- the profiles-self-only case elsewhere, there's no RLS recursion risk
-- to route around here.
drop policy "Anyone can record a view on a published post" on public.post_views;

create policy "Anyone but the post's own author can record a view"
  on public.post_views for insert
  with check (
    exists (
      select 1 from public.posts
      where id = post_id
        and status = 'published'
        and author_id is distinct from auth.uid()
    )
  );
