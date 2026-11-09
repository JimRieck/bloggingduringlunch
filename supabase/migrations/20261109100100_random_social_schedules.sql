-- "Random" social posting (recurrence = 'random', added in
-- 20261109100000_social_random_recurrence.sql): the author picks how many
-- times a day to post and an end date, the browser plans every post time
-- and a randomly chosen blog post for each (src/web/src/lib/
-- randomSchedule.js), the author reviews that plan, and it's saved here
-- exactly as reviewed -- one schedule, with one slot per planned post.
--
-- Unlike daily/weekly/monthly, a random schedule's times can't be worked
-- out from a formula, so its next run always comes from its slots:
-- next_run_at is the earliest slot not yet attempted. Everything else --
-- claiming due schedules, the cron job, pause/resume, run history, the
-- 20-active-schedules cap (a whole random schedule counts as one) -- is
-- the existing machinery from 20260921100000_linkedin_scheduled_posts.sql.

create table public.scheduled_social_post_slots (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.scheduled_social_posts(id) on delete cascade,
  run_at timestamptz not null,
  -- The post chosen for this slot. If it's later deleted (null) or
  -- unpublished, the worker picks another of the author's published
  -- posts at random instead (_shared/linkedin.ts).
  post_id uuid references public.posts(id) on delete set null,
  -- What goes out, as the author reviewed it: the post's title,
  -- description and link (linkedinPostTemplate).
  message text not null check (char_length(message) between 1 and 3000),
  -- When the worker ran this slot, posted or failed. A slot passed while
  -- the app was down is never attempted -- skipped, not posted late, the
  -- same as a missed daily occurrence.
  attempted_at timestamptz,
  unique (schedule_id, run_at)
);

alter table public.scheduled_social_post_slots enable row level security;

create policy "Users can view the slots of their own schedules"
  on public.scheduled_social_post_slots for select
  using (exists (
    select 1 from public.scheduled_social_posts s
    where s.id = schedule_id and s.user_id = auth.uid()
  ));

-- Read-only to the author; created only by create_random_social_schedule
-- and updated only by the worker functions below.
grant select on public.scheduled_social_post_slots to authenticated;
grant select, insert, update, delete on public.scheduled_social_post_slots to service_role;

-- The earliest slot of a random schedule still to run after `after_ts`.
create function public.social_next_slot(p_schedule_id uuid, after_ts timestamptz)
returns timestamptz
language sql stable
set search_path = public
as $$
  select min(run_at)
  from public.scheduled_social_post_slots
  where schedule_id = p_schedule_id
    and attempted_at is null
    and run_at > after_ts;
$$;

-- No formula for 'random' -- its times come from social_next_slot.
-- (Without this, the step below would have fallen through to "monthly".)
create or replace function public.social_next_run(
  first_run timestamptz,
  tz text,
  rec public.social_recurrence,
  after_ts timestamptz
)
returns timestamptz
language plpgsql stable
as $$
declare
  local_first timestamp := first_run at time zone tz;
  step interval;
  k int := 0;
  candidate timestamptz;
begin
  if rec in ('none', 'random') then
    return null;
  end if;
  step := case rec when 'daily' then interval '1 day' when 'weekly' then interval '1 week' else interval '1 month' end;
  loop
    k := k + 1;
    candidate := (local_first + k * step) at time zone tz;
    exit when candidate > after_ts;
    if k > 20000 then
      return null;
    end if;
  end loop;
  return candidate;
end;
$$;

-- Same as before, plus: a random schedule can only be made by
-- create_random_social_schedule (which adds its slots in the same
-- transaction) -- a plain insert with recurrence 'random' would be a
-- schedule with nothing to post.
create or replace function public.prepare_scheduled_social_post()
returns trigger
language plpgsql
as $$
declare
  m text;
  active_count int;
begin
  if new.recurrence = 'random' and coalesce(current_setting('app.creating_random_schedule', true), '') <> 'on' then
    raise exception 'random schedules are created with create_random_social_schedule';
  end if;

  perform now() at time zone new.timezone;  -- raises on an unknown zone name

  foreach m in array new.messages loop
    if length(trim(m)) = 0 or length(m) > 3000 then
      raise exception 'each message must be between 1 and 3000 characters';
    end if;
  end loop;

  select count(*) into active_count
  from public.scheduled_social_posts
  where user_id = new.user_id and status = 'scheduled';
  if active_count >= 20 then
    raise exception 'too many active scheduled posts (max 20)';
  end if;

  -- "Post now" and small client clock skew both land in the past; treat
  -- that as "as soon as possible" rather than an error.
  if new.first_run_at < now() then
    new.first_run_at := now();
  end if;
  if new.ends_at is not null and new.ends_at <= new.first_run_at then
    raise exception 'ends_at must be after the first run';
  end if;

  new.next_run_at := new.first_run_at;
  new.status := 'scheduled';
  return new;
end;
$$;

-- Saves a reviewed random schedule: p_slots is the plan as the author saw
-- it, [{ run_at, post_id, message }]. Slots whose time has already passed
-- (the author took a while to confirm) are dropped; everything else is
-- checked before anything is saved:
--   - every slot links one of the caller's own published posts;
--   - every message is 1-3000 characters;
--   - at most 5 a day (in the schedule's time zone), within 92 days.
--
-- security definer, like set_social_post_paused: the caller can't insert
-- slots (or a 'random' schedule) directly, and auth.uid() still scopes
-- everything to them. T-SQL analogue: a proc with EXECUTE AS OWNER that
-- takes a table-valued parameter -- here a jsonb array unpacked with
-- jsonb_to_recordset.
create function public.create_random_social_schedule(p_timezone text, p_slots jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  slot_count int;
  first_at timestamptz;
  last_at timestamptz;
  first_message text;
  new_id uuid;
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'slots must be a list';
  end if;
  perform now() at time zone p_timezone;  -- raises on an unknown zone name

  create temporary table pending_slots on commit drop as
    select s.run_at, s.post_id, s.message
    from jsonb_to_recordset(p_slots) as s(run_at timestamptz, post_id uuid, message text)
    where s.run_at > now();

  select count(*), min(run_at), max(run_at) into slot_count, first_at, last_at from pending_slots;
  if slot_count = 0 then
    raise exception 'every planned time has already passed';
  end if;
  if slot_count > 500 then
    raise exception 'too many posts in one schedule (max 500)';
  end if;
  if last_at - first_at > interval '92 days' then
    raise exception 'a random schedule can cover at most 90 days';
  end if;
  if exists (select 1 from pending_slots where message is null or length(trim(message)) = 0 or length(message) > 3000) then
    raise exception 'each message must be between 1 and 3000 characters';
  end if;
  if exists (
    select 1 from pending_slots ps
    where ps.post_id is null
       or not exists (
         select 1 from public.posts p
         where p.id = ps.post_id and p.author_id = uid and p.status = 'published'
       )
  ) then
    raise exception 'each post must be one of your published posts';
  end if;
  if exists (
    select 1 from pending_slots
    group by (run_at at time zone p_timezone)::date
    having count(*) > 5
  ) then
    raise exception 'at most 5 posts a day';
  end if;

  select message into first_message from pending_slots order by run_at limit 1;

  perform set_config('app.creating_random_schedule', 'on', true);
  insert into public.scheduled_social_posts (user_id, post_id, messages, first_run_at, timezone, recurrence, ends_at)
  values (uid, null, array[first_message], first_at, p_timezone, 'random', case when slot_count > 1 then last_at end)
  returning id into new_id;
  perform set_config('app.creating_random_schedule', 'off', true);

  insert into public.scheduled_social_post_slots (schedule_id, run_at, post_id, message)
  select new_id, run_at, post_id, message from pending_slots;

  return new_id;
end;
$$;

revoke execute on function public.create_random_social_schedule(text, jsonb) from public, anon;
grant execute on function public.create_random_social_schedule(text, jsonb) to authenticated;

-- Same as before, plus random schedules: the slot that just ran is marked
-- attempted, and the next run is the next slot still ahead -- so a slot
-- run early by "Post now" isn't run again at its own time, and slots
-- missed while the app was down are skipped.
create or replace function public.complete_social_post_run(
  p_id uuid,
  p_ok boolean,
  p_external_id text,
  p_error text,
  p_message text,
  p_fatal boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.scheduled_social_posts;
  nxt timestamptz;
begin
  select * into r from public.scheduled_social_posts where id = p_id for update;
  if not found then
    return;
  end if;

  insert into public.social_post_runs (schedule_id, user_id, status, external_id, error, message)
  values (r.id, r.user_id, case when p_ok then 'success' else 'failed' end, p_external_id, p_error, p_message);

  if r.recurrence = 'random' then
    update public.scheduled_social_post_slots
    set attempted_at = now()
    where schedule_id = r.id and run_at = r.next_run_at;
  end if;

  -- A fatal error (not connected, token revoked/expired) stops the whole
  -- schedule; anything else on a repeating schedule just moves on to the
  -- next occurrence. Occurrences missed while the app was down are
  -- skipped, not posted as a backlog.
  if p_fatal or r.recurrence = 'none' then
    nxt := null;
  elsif r.recurrence = 'random' then
    nxt := public.social_next_slot(r.id, now());
  else
    nxt := public.social_next_run(r.first_run_at, r.timezone, r.recurrence, now());
    if nxt is not null and r.ends_at is not null and nxt > r.ends_at then
      nxt := null;
    end if;
  end if;

  update public.scheduled_social_posts
  set run_count = run_count + 1,
      last_run_at = now(),
      last_error = case when p_ok then null else p_error end,
      locked_at = null,
      next_run_at = nxt,
      status = case
        when p_fatal then 'failed'::public.social_post_status
        when nxt is not null then 'scheduled'::public.social_post_status
        when p_ok then 'completed'::public.social_post_status
        else 'failed'::public.social_post_status
      end
  where id = p_id;
end;
$$;

-- Same as before, plus random schedules: resuming carries on from the
-- next slot still ahead.
create or replace function public.set_social_post_paused(p_id uuid, p_paused boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r public.scheduled_social_posts;
  nxt timestamptz;
begin
  select * into r from public.scheduled_social_posts
  where id = p_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'scheduled post not found';
  end if;

  if p_paused then
    update public.scheduled_social_posts
    set status = 'paused', locked_at = null
    where id = p_id and status = 'scheduled';
    return;
  end if;

  if r.status not in ('paused', 'failed') then
    return;
  end if;

  if r.recurrence = 'none' then
    nxt := greatest(coalesce(r.next_run_at, now()), now());
  elsif r.next_run_at is not null and r.next_run_at > now() then
    nxt := r.next_run_at;
  elsif r.recurrence = 'random' then
    nxt := public.social_next_slot(r.id, now());
  else
    nxt := public.social_next_run(r.first_run_at, r.timezone, r.recurrence, now());
    if nxt is not null and r.ends_at is not null and nxt > r.ends_at then
      nxt := null;
    end if;
  end if;

  update public.scheduled_social_posts
  set status = case when nxt is null then 'completed'::public.social_post_status else 'scheduled'::public.social_post_status end,
      next_run_at = nxt,
      last_error = null,
      locked_at = null
  where id = p_id;
end;
$$;

-- Same as before, plus random schedules: their upcoming runs are their
-- remaining slots (variation is always 1 -- each slot has its own text,
-- which the app reads from the slots table).
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

  if s.recurrence = 'random' then
    return query
      select sl.run_at, 1
      from public.scheduled_social_post_slots sl
      where sl.schedule_id = s.id and sl.attempted_at is null and sl.run_at >= s.next_run_at
      order by sl.run_at
      limit wanted;
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
