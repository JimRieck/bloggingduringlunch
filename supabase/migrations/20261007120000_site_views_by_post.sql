-- Per-post drill-down for the admin site traffic chart (SiteStats.jsx):
-- every post viewed in [start_date, end_date] (UTC calendar dates,
-- inclusive), most-viewed first, with its title, blog and author.
--
-- `security invoker`, like site_views_by_day/site_views_by_author
-- (20260910125019), so post_views' RLS still applies: a site admin sees
-- every post's views, anyone else only their own org's. The joins are
-- left joins because a post that's since been unpublished isn't
-- readable through the posts table's RLS any more -- its views still
-- count, it just comes back without a title.
create or replace function public.site_views_by_post(start_date date, end_date date)
returns table(
  post_id uuid,
  title text,
  post_slug text,
  blog_name text,
  blog_slug text,
  author_name text,
  views bigint
)
language sql
stable
set search_path = public
as $$
  select pv.post_id, p.title, p.slug, o.name, o.slug, pp.display_name, count(*) as views
  from public.post_views pv
  left join public.posts p on p.id = pv.post_id
  left join public.organizations_public o on o.id = p.organization_id
  left join public.public_profiles pp on pp.id = p.author_id
  where pv.viewed_at >= start_date and pv.viewed_at < end_date + interval '1 day'
  group by pv.post_id, p.title, p.slug, o.name, o.slug, pp.display_name
  order by views desc, p.title;
$$;

revoke execute on function public.site_views_by_post(date, date) from public, anon;
grant execute on function public.site_views_by_post(date, date) to authenticated;
