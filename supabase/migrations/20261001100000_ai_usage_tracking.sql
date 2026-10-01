-- One row per AI request a user triggers from the editor (suggest
-- titles, auto-suggest tags/categories, generate a draft, generate an
-- image, bulk auto-tag). Written only by the AI Edge Functions
-- themselves (supabase/functions/_shared/aiUsage.ts) with the
-- service-role key, after the caller is authenticated and the feature
-- flag is confirmed on -- never by the browser, so a row can't be
-- forged or skipped by a client. Failed requests are recorded too
-- (`succeeded = false` plus the same error code the function returned),
-- since "people are clicking this and it isn't working" is exactly what
-- the admin page should surface.
--
-- `feature` is plain text rather than an enum so adding an AI feature
-- later doesn't need a migration (an enum here is Postgres's equivalent
-- of a T-SQL CHECK constraint on a fixed list -- changing the list means
-- ALTER TYPE). The known values and their display labels live in
-- src/web/src/lib/aiUsage.js.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  succeeded boolean not null,
  error_code text,
  created_at timestamptz not null default now()
);

alter table public.ai_usage_events enable row level security;

-- Read-only for site admins; nobody else can see it, and no client role
-- can write to it at all (no insert/update/delete grant or policy).
revoke all on public.ai_usage_events from anon, authenticated;
grant select on public.ai_usage_events to authenticated;

create policy "Site admins can view AI usage"
  on public.ai_usage_events for select
  using (public.is_site_admin());

-- Both RPCs below filter on created_at alone.
create index ai_usage_events_created_at_idx on public.ai_usage_events (created_at);

-- Aggregated in the database rather than by downloading raw rows, for
-- the same reason as site_views_by_day (20260910125019): PostgREST caps
-- a response at 1,000 rows, so summing in the browser would silently
-- undercount a busy range. Both are `security invoker` (the default),
-- so they stay subject to the RLS above -- a non-admin caller gets an
-- empty result, not an error and not someone else's data. Dates are UTC
-- calendar dates, inclusive on both ends.

-- One row per feature used in the range, busiest first.
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
  where e.created_at >= start_date and e.created_at < end_date + 1
  group by e.feature
  order by calls desc, e.feature;
$$;

grant execute on function public.ai_usage_by_feature(date, date) to authenticated;

-- One row per user who made a call in the range, heaviest users first,
-- capped at the top 100. Joins profiles directly: "Site admins can view
-- all profiles" already lets the only caller who can see any rows here
-- read every name/email.
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
  where e.created_at >= start_date and e.created_at < end_date + 1
  group by e.user_id, p.display_name, p.email
  order by calls desc, last_used_at desc
  limit 100;
$$;

grant execute on function public.ai_usage_by_user(date, date) to authenticated;
