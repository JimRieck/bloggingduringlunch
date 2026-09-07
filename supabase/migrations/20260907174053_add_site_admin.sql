-- Site admin: a platform-wide role, separate from the per-org
-- owner/admin/editor/member roles in org_role. Starts with account
-- disabling; is_site_admin() is generic groundwork for future
-- admin-only features, not just this one.
--
-- `disabled` mirrors the real ban state (auth.users.banned_until,
-- set via the admin API in supabase/functions/admin-set-account-status)
-- so the client has something to read/display -- banned_until itself
-- isn't exposed through PostgREST at all.
alter table public.profiles
  add column is_site_admin boolean not null default false,
  add column disabled boolean not null default false;

create or replace function public.is_site_admin()
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_site_admin
  );
$$;

create policy "Site admins can view all profiles"
  on public.profiles for select
  using (public.is_site_admin());
