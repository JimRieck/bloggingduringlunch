-- Same fix as 20260910125019 (the admin site traffic chart), applied
-- to the author-facing "My stats" chart (MyStats.jsx): it downloaded
-- every individual post_views row for the selected posts/range and
-- summed them up client-side, which has the exact same 1,000-row
-- PostgREST response cap risk for a popular post/wide range as the
-- site-wide chart had -- just not caught by the original review,
-- since it only looked at the new SiteStats.jsx code.
--
-- Both `security invoker` (the default), so they stay subject to
-- post_views' existing RLS exactly like a plain select would -- an
-- author only ever sees real counts for posts their org actually
-- owns; passing someone else's post_id just yields a zero-filled row
-- for it rather than leaking another org's numbers.

-- One row per id in post_ids, zero-filled for a post with no views in
-- range -- backs the "All posts" pie chart.
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
    and pv.viewed_at >= start_date and pv.viewed_at < end_date + interval '1 day'
  group by ids.id;
$$;

grant execute on function public.my_post_views_by_post(uuid[], date, date) to authenticated;

-- One zero-filled row per calendar day in range, for a single post --
-- backs the per-post line chart.
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
    and pv.viewed_at >= d and pv.viewed_at < d + interval '1 day'
  group by d
  order by d;
$$;

grant execute on function public.my_post_views_by_day(uuid, date, date) to authenticated;
