-- LinkedIn posting: OAuth connection, scheduled/repeating posts, and the
-- cron plumbing that fires them. Everything here is gated in the app by
-- the `linkedin_posting` feature flag (off by default).
insert into public.feature_flags (key, enabled) values ('linkedin_posting', false);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Connection + OAuth state. Tokens must never reach a browser, so these
-- tables have RLS on, no policies, and no grants: only the service role
-- (Edge Functions) can touch them. Clients read connection status
-- through my_linkedin_connection() below, which never returns the token.
-- ---------------------------------------------------------------------
create table public.linkedin_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_urn text not null,
  member_name text,
  access_token text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now()
);

create table public.linkedin_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.linkedin_connections enable row level security;
alter table public.linkedin_oauth_states enable row level security;
revoke all on public.linkedin_connections from anon, authenticated;
revoke all on public.linkedin_oauth_states from anon, authenticated;

-- T-SQL analogue: a stored proc with EXECUTE AS OWNER. "security definer"
-- runs with the function owner's rights, so it can read the locked-down
-- table, while `where user_id = auth.uid()` still scopes it to the caller.
create function public.my_linkedin_connection()
returns table (member_name text, expires_at timestamptz, connected_at timestamptz)
language sql security definer set search_path = public stable
as $$
  select member_name, expires_at, connected_at
  from public.linkedin_connections
  where user_id = auth.uid();
$$;

create function public.disconnect_linkedin()
returns void
language sql security definer set search_path = public
as $$
  delete from public.linkedin_connections where user_id = auth.uid();
$$;

revoke execute on function public.my_linkedin_connection() from public, anon;
revoke execute on function public.disconnect_linkedin() from public, anon;
grant execute on function public.my_linkedin_connection() to authenticated;
grant execute on function public.disconnect_linkedin() to authenticated;

-- ---------------------------------------------------------------------
-- Scheduled posts
-- ---------------------------------------------------------------------
create type public.social_recurrence as enum ('none', 'daily', 'weekly', 'monthly');
create type public.social_post_status as enum ('scheduled', 'paused', 'completed', 'failed');

create table public.scheduled_social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  network text not null default 'linkedin' check (network in ('linkedin')),
  post_id uuid references public.posts(id) on delete set null,
  -- LinkedIn tends to reject byte-identical repeat posts, so a schedule can
  -- carry several variants; run N posts messages[N mod count].
  messages text[] not null check (cardinality(messages) between 1 and 10),
  first_run_at timestamptz not null,
  next_run_at timestamptz,
  timezone text not null default 'UTC',
  recurrence public.social_recurrence not null default 'none',
  ends_at timestamptz,
  status public.social_post_status not null default 'scheduled',
  run_count int not null default 0,
  last_run_at timestamptz,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create index scheduled_social_posts_due_idx
  on public.scheduled_social_posts (next_run_at)
  where status = 'scheduled';

create table public.social_post_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.scheduled_social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ran_at timestamptz not null default now(),
  status text not null check (status in ('success', 'failed')),
  external_id text,
  error text,
  message text
);

create index social_post_runs_schedule_idx on public.social_post_runs (schedule_id, ran_at desc);

alter table public.scheduled_social_posts enable row level security;
alter table public.social_post_runs enable row level security;

create policy "Users can view their own scheduled posts"
  on public.scheduled_social_posts for select
  using (user_id = auth.uid());

-- Only a post the caller authored can be linked -- otherwise a schedule
-- could be aimed at (and expose the title of) someone else's draft.
create policy "Users can schedule posts for their own account"
  on public.scheduled_social_posts for insert
  with check (
    user_id = auth.uid()
    and (
      post_id is null
      or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid())
    )
  );

create policy "Users can delete their own scheduled posts"
  on public.scheduled_social_posts for delete
  using (user_id = auth.uid());

create policy "Users can view their own post runs"
  on public.social_post_runs for select
  using (user_id = auth.uid());

-- Column-level insert grant: a client can only ever supply the fields
-- that describe *what* to post and *when*. status/run_count/next_run_at
-- and friends are owned by the server side. There is no UPDATE grant at
-- all -- pause/resume goes through set_social_post_paused() below.
revoke all on public.scheduled_social_posts from anon, authenticated;
revoke all on public.social_post_runs from anon, authenticated;
grant select, delete on public.scheduled_social_posts to authenticated;
grant insert (post_id, messages, first_run_at, timezone, recurrence, ends_at)
  on public.scheduled_social_posts to authenticated;
grant select on public.social_post_runs to authenticated;

create function public.prepare_scheduled_social_post()
returns trigger
language plpgsql
as $$
declare
  m text;
  active_count int;
begin
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

create trigger prepare_scheduled_social_post
  before insert on public.scheduled_social_posts
  for each row execute function public.prepare_scheduled_social_post();

-- ---------------------------------------------------------------------
-- Recurrence math. Computed in the user's own timezone so a daily 9:00
-- post stays at 9:00 local across a DST change, and always from the
-- *first* run (Jan 31 + 1 month = Feb 28, but + 2 months = Mar 31, not
-- Mar 28). Returns the first occurrence strictly after `after_ts`.
--
-- T-SQL analogue: a loop of DATEADD(month, k, @first) with AT TIME ZONE.
-- In Postgres, `int * interval` scales an interval, and `timestamp AT TIME
-- ZONE tz` turns a local wall-clock time back into an absolute instant.
-- ---------------------------------------------------------------------
create function public.social_next_run(
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
  if rec = 'none' then
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

-- ---------------------------------------------------------------------
-- Worker plumbing (service role only). claim_* takes a short lock so two
-- overlapping worker runs can't post the same schedule twice; a lock
-- older than 10 minutes is treated as a crashed worker and reclaimed.
--
-- T-SQL analogue of `for update skip locked`: WITH (UPDLOCK, READPAST).
-- ---------------------------------------------------------------------
create function public.claim_due_social_posts(max_rows int default 20)
returns setof public.scheduled_social_posts
language sql security definer set search_path = public
as $$
  update public.scheduled_social_posts s
  set locked_at = now()
  where s.id in (
    select id from public.scheduled_social_posts
    where status = 'scheduled'
      and next_run_at <= now()
      and (locked_at is null or locked_at < now() - interval '10 minutes')
    order by next_run_at
    limit max_rows
    for update skip locked
  )
  returning s.*;
$$;

-- Used by "Post now": run one specific schedule immediately, regardless
-- of its next_run_at.
create function public.claim_social_post(p_id uuid)
returns setof public.scheduled_social_posts
language sql security definer set search_path = public
as $$
  update public.scheduled_social_posts s
  set locked_at = now()
  where s.id = p_id
    and s.status = 'scheduled'
    and (s.locked_at is null or s.locked_at < now() - interval '10 minutes')
  returning s.*;
$$;

create function public.complete_social_post_run(
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

  -- A fatal error (not connected, token revoked/expired) stops the whole
  -- schedule; anything else on a repeating schedule just moves on to the
  -- next occurrence. Occurrences missed while the app was down are
  -- skipped, not posted as a backlog.
  if p_fatal or r.recurrence = 'none' then
    nxt := null;
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

revoke execute on function public.claim_due_social_posts(int) from public, anon, authenticated;
revoke execute on function public.claim_social_post(uuid) from public, anon, authenticated;
revoke execute on function public.complete_social_post_run(uuid, boolean, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_due_social_posts(int) to service_role;
grant execute on function public.claim_social_post(uuid) to service_role;
grant execute on function public.complete_social_post_run(uuid, boolean, text, text, text, boolean)
  to service_role;

-- User-facing pause/resume. Resuming skips anything missed while paused
-- instead of firing a burst of catch-up posts, and is also how a failed
-- schedule is retried after reconnecting.
create function public.set_social_post_paused(p_id uuid, p_paused boolean)
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

revoke execute on function public.set_social_post_paused(uuid, boolean) from public, anon;
grant execute on function public.set_social_post_paused(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Cron. A secret is generated here, inside the database, and kept in
-- Vault -- never in git. The Edge Function that receives the call checks
-- it through check_social_cron_secret(). The job also needs a
-- `functions_base_url` Vault secret (differs per environment, so it's
-- set once by hand -- see ROADMAP.md); until that exists, or while
-- nothing is due, the job does nothing at all.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'social_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'social_cron_secret',
      'Shared secret the social-post cron job sends to linkedin-process-due'
    );
  end if;
end;
$$;

create function public.check_social_cron_secret(p_secret text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'social_cron_secret' and decrypted_secret = p_secret
  );
$$;

revoke execute on function public.check_social_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_social_cron_secret(text) to service_role;

select cron.schedule(
  'process-social-posts',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'functions_base_url')
             || '/linkedin-process-due',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'social_cron_secret')
      ),
      body := '{}'::jsonb
    )
    where exists (select 1 from vault.decrypted_secrets where name = 'functions_base_url')
      and exists (
        select 1 from public.scheduled_social_posts
        where status = 'scheduled' and next_run_at <= now()
      );
  $job$
);
