-- Feature announcements: site admins write an email (subject + rich-text
-- body, same editor as posts), save it as a draft, and send it to every
-- active user. Sent ones stay as a read-only history.
--
-- body_html is the editor's own HTML, kept so a draft reopens in the
-- editor exactly as written. email_html/email_text are the email-safe
-- versions (inline styles, embeds turned into links) built from it in
-- the browser on every save (src/web/src/lib/announcementEmail.js) --
-- what the send-announcement Edge Function actually sends, so the
-- history shows exactly what recipients got.
create type public.announcement_status as enum ('draft', 'sending', 'sent');

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  subject text not null default '' check (char_length(subject) <= 200),
  body_html text not null default '',
  email_html text not null default '',
  email_text text not null default '',
  -- Everyone active gets it except the users unchecked here -- so the
  -- default (empty) is everyone, including anyone who signs up between
  -- saving the draft and sending it.
  excluded_user_ids uuid[] not null default '{}',
  status public.announcement_status not null default 'draft',
  -- Nullable + set null, not cascade: the history should outlive an
  -- admin's account.
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  recipient_count integer,
  failed_count integer
);

create index announcements_status_idx on public.announcements (status, sent_at desc);

create or replace function public.touch_announcement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger announcements_touch
  before update on public.announcements
  for each row execute function public.touch_announcement();

alter table public.announcements enable row level security;

-- Site admins only. The browser can write the content columns of a
-- draft and nothing else: status, sent_* and the counts are only ever
-- set by the send-announcement Edge Function (service role), so a
-- client can't mark something sent, or edit or delete one that was.
-- (Column-level grants are Postgres's equivalent of T-SQL's
-- GRANT UPDATE (col, ...) ON table.)
revoke all on public.announcements from anon, authenticated;
grant select, delete on public.announcements to authenticated;
grant insert (subject, body_html, email_html, email_text, excluded_user_ids) on public.announcements to authenticated;
grant update (subject, body_html, email_html, email_text, excluded_user_ids) on public.announcements to authenticated;

create policy "Site admins can view announcements"
  on public.announcements for select
  using (public.is_site_admin());

create policy "Site admins can create drafts"
  on public.announcements for insert
  with check (public.is_site_admin() and status = 'draft');

create policy "Site admins can edit drafts"
  on public.announcements for update
  using (public.is_site_admin() and status = 'draft')
  with check (public.is_site_admin() and status = 'draft');

create policy "Site admins can delete drafts"
  on public.announcements for delete
  using (public.is_site_admin() and status = 'draft');

-- Who an announcement goes to: every account that has confirmed its
-- email and isn't disabled (profiles.disabled mirrors the Auth ban; the
-- banned_until check covers the gap if the two ever disagree).
-- Security definer because it reads auth.users; only the service role
-- (the Edge Function) may call it -- it returns every user's email.
create or replace function public.announcement_recipients()
returns table(user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where not p.disabled
    and u.email is not null
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until < now())
  order by u.created_at;
$$;

revoke execute on function public.announcement_recipients() from public, anon, authenticated;
grant execute on function public.announcement_recipients() to service_role;

-- The same list with names, for the recipient checkboxes on the admin
-- screen -- site admins only (no rows for anyone else).
create or replace function public.announcement_recipient_list()
returns table(user_id uuid, display_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, p.display_name, r.email
  from public.announcement_recipients() r
  join public.profiles p on p.id = r.user_id
  where public.is_site_admin()
  order by lower(coalesce(nullif(p.display_name, ''), r.email));
$$;

revoke execute on function public.announcement_recipient_list() from public, anon;
grant execute on function public.announcement_recipient_list() to authenticated;

-- Claims a draft for sending in one atomic step, so two clicks (or two
-- admins) can't send the same announcement twice: only the call that
-- flips it from draft to sending gets the row back. Service role only.
create or replace function public.claim_announcement_for_sending(p_id uuid, p_sent_by uuid)
returns setof public.announcements
language sql
security definer
set search_path = ''
as $$
  update public.announcements
  set status = 'sending', sent_by = p_sent_by
  where id = p_id and status = 'draft'
  returning *;
$$;

revoke execute on function public.claim_announcement_for_sending(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_announcement_for_sending(uuid, uuid) to service_role;
