-- The next few times a scheduled LinkedIn post will go out, for the
-- "Coming up" list on /social. Worked out with the same rules the
-- scheduler itself uses (20260921100000_linkedin_scheduled_posts.sql):
-- social_next_run for each following occurrence -- in the author's own
-- time zone, daylight saving and month ends included -- stopping at
-- ends_at (an occurrence on or before it still counts) and never past a
-- one-time post's single run. `variation` is which message (1-based) that
-- run will use: the scheduler posts messages[run_count mod n], and
-- run_count goes up on every attempt, success or not.
--
-- `security invoker`: the select below is subject to
-- scheduled_social_posts' RLS, so you only ever get your own schedules'
-- times. Nothing for a paused, finished or failed schedule.
create or replace function public.upcoming_social_runs(p_schedule_id uuid, p_count int default 5)
returns table(run_at timestamptz, variation int)
language plpgsql
stable
set search_path = public
as $$
declare
  s public.scheduled_social_posts;
  t timestamptz;
  i int := 0;
  wanted int := least(greatest(coalesce(p_count, 5), 1), 20);
begin
  select * into s from public.scheduled_social_posts where id = p_schedule_id;
  if not found or s.status <> 'scheduled' or s.next_run_at is null then
    return;
  end if;

  t := s.next_run_at;
  while t is not null and i < wanted and (s.ends_at is null or t <= s.ends_at) loop
    run_at := t;
    variation := ((s.run_count + i) % cardinality(s.messages)) + 1;
    return next;
    i := i + 1;
    t := public.social_next_run(s.first_run_at, s.timezone, s.recurrence, t);
  end loop;
end;
$$;

revoke execute on function public.upcoming_social_runs(uuid, int) from public, anon;
grant execute on function public.upcoming_social_runs(uuid, int) to authenticated;
