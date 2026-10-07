-- Two-factor authentication is required for every account. Logging in
-- with a password alone only gets a first-step ("aal1") session; the
-- session becomes "aal2" once the user also enters a code from their
-- authenticator app (Supabase Auth's built-in TOTP MFA). The app walks
-- people through that, but the app's screens aren't the security
-- boundary -- someone with a stolen password could skip them and call
-- the API directly. These are the boundary.
--
-- 1. Every database request through the API (tables, views and RPCs
--    alike) runs this check first: PostgREST calls the function named
--    in its `db_pre_request` setting before each request, in the same
--    transaction, as the requesting role. An `authenticated` request
--    whose token isn't aal2 is rejected with HTTP 403 before any query
--    runs. Anonymous visitors (role `anon`, the public blog) and the
--    service role (Edge Functions, pg_cron) aren't affected.
--    One choke point rather than a restrictive policy on every table:
--    it also covers views and security-definer RPCs, which table RLS
--    alone wouldn't, and every future table is covered automatically.
--    (Closest T-SQL analogue: a logon-style check that runs before
--    every batch, rather than a predicate on each table.)
create or replace function public.enforce_mfa()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if claims->>'role' = 'authenticated' and coalesce(claims->>'aal', '') <> 'aal2' then
    -- PostgREST turns SQLSTATE PTxyz into HTTP status xyz.
    raise exception using
      errcode = 'PT403',
      message = 'mfa_required',
      hint = 'Enter a code from your authenticator app to finish logging in.';
  end if;
end;
$$;

grant execute on function public.enforce_mfa() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.enforce_mfa';
notify pgrst, 'reload config';

-- 2. File uploads go through the Storage API, not PostgREST, so the
--    check above doesn't see them. A restrictive policy is ANDed with
--    the existing per-bucket policies on storage.objects, so it can
--    only ever take access away.
create policy "Logged-in storage access requires a second factor"
  on storage.objects
  as restrictive
  for all
  to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2')
  with check ((select auth.jwt()->>'aal') = 'aal2');

-- 3. Edge Functions identify the caller themselves; supabase/functions/
--    _shared/auth.ts's getCaller rejects a non-aal2 token there.
