-- Where site traffic comes from, for the "Traffic sources" section of
-- /admin (TrafficSources.jsx).
--
-- 1. Readers. post_views has stored each view's referrer (the page the
--    reader clicked through from) since it was created. This adds the
--    link's utm_source tag alongside it -- e.g. ?utm_source=linkedin,
--    which the site adds to the links it posts to LinkedIn -- because
--    phone apps often hide the referrer, and a tag survives that. The
--    RPC below groups views by referring website and tag; turning those
--    into named sources (LinkedIn, Google, ChatGPT...) happens in the
--    browser (src/web/src/lib/trafficSources.js), where the list of
--    known sites is easy to extend and test.
alter table public.post_views
  add column utm_source text check (utm_source is null or char_length(utm_source) <= 100);

-- `security invoker` like the other site-stats RPCs (20260910125019):
-- post_views' RLS still applies, so a site admin sees the whole site
-- and anyone else only their own org's views. The host is just the
-- domain part of the referrer URL.
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
  where pv.viewed_at >= start_date and pv.viewed_at < end_date + interval '1 day'
  group by 1, 2
  order by views desc;
$$;

revoke execute on function public.site_traffic_sources(date, date) from public, anon;
grant execute on function public.site_traffic_sources(date, date) to authenticated;

-- 2. Bots. Crawlers don't run the page's JavaScript, which is what
--    records a view, so they never show up in post_views at all. Every
--    post link does pass through a server function first, though
--    (src/web/api/og.js, which builds link previews); it recognises
--    known bots by their user agent and records them here, separately
--    from readers so they never inflate view counts.
create table public.bot_visits (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  bot_name text not null check (char_length(bot_name) between 1 and 60),
  bot_category text not null check (bot_category in ('ai', 'search', 'preview', 'other')),
  user_agent text check (char_length(user_agent) <= 400),
  visited_at timestamptz not null default now()
);

create index bot_visits_visited_at_idx on public.bot_visits (visited_at);

alter table public.bot_visits enable row level security;

revoke all on public.bot_visits from anon, authenticated;
grant select on public.bot_visits to authenticated;

create policy "Site admins can view bot visits"
  on public.bot_visits for select
  using (public.is_site_admin());

-- The only way in: the og function calls this with the public (anon)
-- key. It only records a visit to a post that exists and is published,
-- and only with a known category. Like post_views, nothing stops
-- someone calling it directly with made-up bot names -- it's traffic
-- insight, not an audit log.
create or replace function public.record_bot_visit(
  p_org_slug text,
  p_post_slug text,
  p_bot_name text,
  p_bot_category text,
  p_user_agent text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.bot_visits (post_id, bot_name, bot_category, user_agent)
  select p.id, p_bot_name, p_bot_category, left(p_user_agent, 400)
  from public.posts p
  join public.organizations o on o.id = p.organization_id
  where o.slug = p_org_slug
    and p.slug = p_post_slug
    and p.status = 'published'
    and char_length(p_bot_name) between 1 and 60
    and p_bot_category in ('ai', 'search', 'preview', 'other');
$$;

revoke execute on function public.record_bot_visit(text, text, text, text, text) from public;
grant execute on function public.record_bot_visit(text, text, text, text, text) to anon, authenticated;

-- One row per bot seen in the range, busiest first, with how many
-- different posts it fetched. `security invoker`: only site admins can
-- read bot_visits, so anyone else gets no rows.
create or replace function public.bot_visit_summary(start_date date, end_date date)
returns table(bot_name text, bot_category text, visits bigint, posts bigint, last_seen timestamptz)
language sql
stable
set search_path = public
as $$
  select bv.bot_name, bv.bot_category, count(*) as visits, count(distinct bv.post_id) as posts, max(bv.visited_at)
  from public.bot_visits bv
  where bv.visited_at >= start_date and bv.visited_at < end_date + interval '1 day'
  group by bv.bot_name, bv.bot_category
  order by visits desc, bv.bot_name;
$$;

revoke execute on function public.bot_visit_summary(date, date) from public, anon;
grant execute on function public.bot_visit_summary(date, date) to authenticated;
