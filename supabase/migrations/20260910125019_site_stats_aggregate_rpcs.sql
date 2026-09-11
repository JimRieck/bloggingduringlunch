-- The admin site traffic chart (SiteStats.jsx) used to download every
-- individual post_views row for the selected range and sum them up in
-- the browser. Flagged in an external code review: PostgREST caps a
-- response at 1,000 rows by default, so a range with more hits than
-- that would silently undercount rather than error -- and it's just
-- more data over the wire than the UI ever needed, when the database
-- can return the handful of aggregate rows directly.
--
-- Two RPCs, one per SiteStats.jsx mode. Both are `security invoker`
-- (the default -- no `security definer` here) so they run as the
-- calling user and stay subject to post_views' existing RLS exactly
-- as a plain select would: a site admin (see "Site admins can view
-- all post views" in 20260909183450) gets the real site-wide
-- picture, while a non-admin authenticated caller -- SiteStats.jsx is
-- the only caller today, and it's gated to /admin, but this makes the
-- RPC itself safe to call from anywhere -- transparently only ever
-- sees their own org's slice, the same as if they'd queried
-- post_views directly. Never granted to anon; there's no logged-out
-- use case for this.

-- One row per calendar day in [start_date, end_date], zero-filled for
-- days with no views (via generate_series + left join) so the chart
-- doesn't have to reconstruct the full date range client-side either.
create or replace function public.site_views_by_day(start_date date, end_date date)
returns table(day date, views bigint)
language sql
stable
set search_path = public
as $$
  select d::date as day, count(pv.id) as views
  from generate_series(start_date, end_date, interval '1 day') as d
  left join public.post_views pv
    on pv.viewed_at >= d and pv.viewed_at < d + interval '1 day'
  group by d
  order by d;
$$;

grant execute on function public.site_views_by_day(date, date) to authenticated;

-- One row per author with at least one view on target_date, most
-- views first. Joins posts -> public_profiles server-side (instead of
-- SiteStats.jsx's old two-step post_id -> author_id -> display_name
-- fetch) since a published post's own RLS already allows this read
-- for any caller regardless of admin status.
create or replace function public.site_views_by_author(target_date date)
returns table(author_id uuid, display_name text, views bigint)
language sql
stable
set search_path = public
as $$
  select p.author_id, pp.display_name, count(pv.id) as views
  from public.post_views pv
  join public.posts p on p.id = pv.post_id
  left join public.public_profiles pp on pp.id = p.author_id
  where pv.viewed_at >= target_date and pv.viewed_at < target_date + interval '1 day'
  group by p.author_id, pp.display_name
  order by views desc;
$$;

grant execute on function public.site_views_by_author(date) to authenticated;

-- Neither RPC filters by post_id, so the existing (post_id, viewed_at
-- desc) index (post_views_post_id_idx, from the original engagement
-- migration) can't help either one -- also flagged in the same
-- review. A plain viewed_at index lets both scan just the rows in
-- range instead of the whole table.
create index post_views_viewed_at_idx on public.post_views (viewed_at);
