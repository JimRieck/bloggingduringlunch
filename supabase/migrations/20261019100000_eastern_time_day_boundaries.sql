-- Every stats query used to split time into days at midnight UTC: each
-- RPC compared a timestamptz with a plain `date`, which Postgres turns
-- into midnight in the session's time zone -- UTC on Supabase. So a
-- view at 9pm Eastern landed on the *next* day (9pm EDT is 01:00 UTC),
-- and every day's total was really 8pm-to-8pm Eastern (7pm in winter).
--
-- The site runs on Eastern time (America/New_York -- EST in winter, EDT
-- in summer, switching automatically). This adds one helper for "the
-- moment an Eastern calendar day starts" and redefines every
-- day-bucketing RPC to use it. Only the day boundaries change: the
-- stored timestamps were always exact moments, so past numbers are
-- simply re-bucketed correctly -- nothing needs backfilling. Function
-- signatures, return shapes and grants are unchanged (`create or
-- replace` keeps existing grants).
--
-- (T-SQL comparison: like `AT TIME ZONE 'Eastern Standard Time'` on a
-- datetimeoffset -- here `timestamp AT TIME ZONE zone` reads a
-- wall-clock time as being in that zone and returns the exact moment.)

-- Midnight at the start of `d`, Eastern time, as an exact moment.
-- E.g. 2026-10-19 -> 2026-10-19 04:00 UTC (EDT); 2026-01-15 -> 05:00 UTC
-- (EST). The zone lives here and only here.
create or replace function public.site_day_start(d date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select d::timestamp at time zone 'America/New_York';
$$;

grant execute on function public.site_day_start(date) to anon, authenticated;

-- Site traffic chart: one zero-filled row per Eastern day in range.
create or replace function public.site_views_by_day(start_date date, end_date date)
returns table(day date, views bigint)
language sql
stable
set search_path = public
as $$
  select d::date as day, count(pv.id) as views
  from generate_series(start_date, end_date, interval '1 day') as d
  left join public.post_views pv
    on pv.viewed_at >= public.site_day_start(d::date)
    and pv.viewed_at < public.site_day_start(d::date + 1)
  group by d
  order by d;
$$;

-- Site traffic chart, single day: views per author.
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
  where pv.viewed_at >= public.site_day_start(target_date)
    and pv.viewed_at < public.site_day_start(target_date + 1)
  group by p.author_id, pp.display_name
  order by views desc;
$$;

-- Site traffic drill-down: views per post.
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
  where pv.viewed_at >= public.site_day_start(start_date)
    and pv.viewed_at < public.site_day_start(end_date + 1)
  group by pv.post_id, p.title, p.slug, o.name, o.slug, pp.display_name
  order by views desc, p.title;
$$;

-- My stats, "All posts": views per post.
create or replace function public.my_post_views_by_post(post_ids uuid[], start_date date, end_date date)
returns table(post_id uuid, views bigint)
language sql
stable
set search_path = public
as $$
  select ids.id as post_id, count(pv.id) as views
  from unnest(post_ids) as ids(id)
  left join public.post_views pv
    on pv.post_id = ids.id
    and pv.viewed_at >= public.site_day_start(start_date)
    and pv.viewed_at < public.site_day_start(end_date + 1)
  group by ids.id;
$$;

-- My stats, one post: views per Eastern day.
create or replace function public.my_post_views_by_day(target_post_id uuid, start_date date, end_date date)
returns table(day date, views bigint)
language sql
stable
set search_path = public
as $$
  select d::date as day, count(pv.id) as views
  from generate_series(start_date, end_date, interval '1 day') as d
  left join public.post_views pv
    on pv.post_id = target_post_id
    and pv.viewed_at >= public.site_day_start(d::date)
    and pv.viewed_at < public.site_day_start(d::date + 1)
  group by d
  order by d;
$$;

-- AI usage.
create or replace function public.ai_usage_by_feature(start_date date, end_date date)
returns table(feature text, calls bigint, failed bigint, users bigint)
language sql
stable
set search_path = public
as $$
  select
    e.feature,
    count(*) as calls,
    count(*) filter (where not e.succeeded) as failed,
    count(distinct e.user_id) as users
  from public.ai_usage_events e
  where e.created_at >= public.site_day_start(start_date)
    and e.created_at < public.site_day_start(end_date + 1)
  group by e.feature
  order by calls desc, e.feature;
$$;

create or replace function public.ai_usage_by_user(start_date date, end_date date)
returns table(user_id uuid, display_name text, email text, calls bigint, failed bigint, last_used_at timestamptz)
language sql
stable
set search_path = public
as $$
  select
    e.user_id,
    p.display_name,
    p.email,
    count(*) as calls,
    count(*) filter (where not e.succeeded) as failed,
    max(e.created_at) as last_used_at
  from public.ai_usage_events e
  left join public.profiles p on p.id = e.user_id
  where e.created_at >= public.site_day_start(start_date)
    and e.created_at < public.site_day_start(end_date + 1)
  group by e.user_id, p.display_name, p.email
  order by calls desc, last_used_at desc
  limit 100;
$$;

-- Traffic sources: readers, and bots.
create or replace function public.site_traffic_sources(start_date date, end_date date)
returns table(referrer_host text, utm_source text, views bigint)
language sql
stable
set search_path = public
as $$
  select
    lower(substring(pv.referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)')) as referrer_host,
    lower(nullif(trim(pv.utm_source), '')) as utm_source,
    count(*) as views
  from public.post_views pv
  where pv.viewed_at >= public.site_day_start(start_date)
    and pv.viewed_at < public.site_day_start(end_date + 1)
  group by 1, 2
  order by views desc;
$$;

create or replace function public.bot_visit_summary(start_date date, end_date date)
returns table(bot_name text, bot_category text, visits bigint, posts bigint, last_seen timestamptz)
language sql
stable
set search_path = public
as $$
  select bv.bot_name, bv.bot_category, count(*) as visits, count(distinct bv.post_id) as posts, max(bv.visited_at)
  from public.bot_visits bv
  where bv.visited_at >= public.site_day_start(start_date)
    and bv.visited_at < public.site_day_start(end_date + 1)
  group by bv.bot_name, bv.bot_category
  order by visits desc, bv.bot_name;
$$;
