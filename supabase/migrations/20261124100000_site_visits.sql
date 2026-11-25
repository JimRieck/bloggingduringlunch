-- Visits to the public home page (bloggingduringlunch.com/), for the
-- "Home page visits" admin page (/admin/visits, HomeVisits.jsx).
--
-- post_views only ever counted reads of a single post; nothing recorded
-- people arriving at the site's front door. Each row here is one
-- signed-out visit to a public page (today only "/"; `path` is stored so
-- other pages can be added later without a new table):
--   - when (visited_at),
--   - which page (path),
--   - where it came from: the referring page and the link's utm_source
--     tag, both turned into a named source (LinkedIn, Google...) in the
--     browser by src/web/src/lib/trafficSources.js, like post views,
--   - roughly where the visitor was: country / region / city from
--     Vercel's own IP geolocation (the x-vercel-ip-* headers the
--     server function src/web/api/visit.js reads). The IP address
--     itself is never stored.
create table public.site_visits (
  id uuid primary key default gen_random_uuid(),
  path text not null check (char_length(path) between 1 and 200 and left(path, 1) = '/'),
  visited_at timestamptz not null default now(),
  referrer text check (referrer is null or char_length(referrer) <= 500),
  utm_source text check (utm_source is null or char_length(utm_source) <= 100),
  country text check (country is null or char_length(country) <= 2),
  region text check (region is null or char_length(region) <= 10),
  city text check (city is null or char_length(city) <= 100)
);

create index site_visits_visited_at_idx on public.site_visits (visited_at);

alter table public.site_visits enable row level security;

-- Only site admins read it (directly or through the RPCs below, which
-- are `security invoker`); nobody writes it except through
-- record_site_visit. service_role for Edge Functions / maintenance, as
-- every table now grants explicitly (20261020120000).
revoke all on public.site_visits from anon, authenticated;
grant select on public.site_visits to authenticated;
grant select, insert, update, delete on public.site_visits to service_role;

create policy "Site admins can view site visits"
  on public.site_visits for select
  using (public.is_site_admin());

-- The only way in: api/visit.js calls this with the public (anon) key,
-- once per signed-out page load. Too-long values are trimmed rather than
-- rejected, so a strange referrer never loses the visit. Like post_views
-- and bot_visits, nothing stops someone calling it directly with made-up
-- values -- it's traffic insight, not an audit log.
create or replace function public.record_site_visit(
  p_path text,
  p_referrer text,
  p_utm_source text,
  p_country text,
  p_region text,
  p_city text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.site_visits (path, referrer, utm_source, country, region, city)
  select
    left(p_path, 200),
    left(nullif(trim(p_referrer), ''), 500),
    left(nullif(trim(p_utm_source), ''), 100),
    upper(left(nullif(trim(p_country), ''), 2)),
    upper(left(nullif(trim(p_region), ''), 10)),
    left(nullif(trim(p_city), ''), 100)
  where left(p_path, 1) = '/';
$$;

revoke execute on function public.record_site_visit(text, text, text, text, text, text) from public;
grant execute on function public.record_site_visit(text, text, text, text, text, text) to anon, authenticated;

-- The chart: one zero-filled row per Eastern day in the range
-- (site_day_start, 20261019100000). `path_filter` null means every page.
create or replace function public.site_visits_by_day(start_date date, end_date date, path_filter text default null)
returns table(day date, visits bigint)
language sql
stable
set search_path = public
as $$
  select d::date as day, count(sv.id) as visits
  from generate_series(start_date, end_date, interval '1 day') as d
  left join public.site_visits sv
    on sv.visited_at >= public.site_day_start(d::date)
    and sv.visited_at < public.site_day_start(d::date + 1)
    and (path_filter is null or sv.path = path_filter)
  group by d
  order by d;
$$;

revoke execute on function public.site_visits_by_day(date, date, text) from public, anon;
grant execute on function public.site_visits_by_day(date, date, text) to authenticated;

-- The table: the visits in the range, newest first, capped at max_rows
-- (the page shows the total from site_visits_by_day alongside, so a cap
-- is visible rather than a silent undercount). Referrer host is
-- extracted here, the same way as site_traffic_sources.
create or replace function public.site_visit_list(
  start_date date,
  end_date date,
  path_filter text default null,
  max_rows integer default 500
)
returns table(
  id uuid,
  visited_at timestamptz,
  path text,
  referrer text,
  referrer_host text,
  utm_source text,
  country text,
  region text,
  city text
)
language sql
stable
set search_path = public
as $$
  select
    sv.id,
    sv.visited_at,
    sv.path,
    sv.referrer,
    lower(substring(sv.referrer from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/:?#]+)')) as referrer_host,
    sv.utm_source,
    sv.country,
    sv.region,
    sv.city
  from public.site_visits sv
  where sv.visited_at >= public.site_day_start(start_date)
    and sv.visited_at < public.site_day_start(end_date + 1)
    and (path_filter is null or sv.path = path_filter)
  order by sv.visited_at desc, sv.id
  limit greatest(1, least(coalesce(max_rows, 500), 5000));
$$;

revoke execute on function public.site_visit_list(date, date, text, integer) from public, anon;
grant execute on function public.site_visit_list(date, date, text, integer) to authenticated;
