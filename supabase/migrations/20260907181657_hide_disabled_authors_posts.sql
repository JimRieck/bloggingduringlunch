-- Disabling an account (profiles.disabled, see admin-set-account-status)
-- bans them from logging in, but on its own does nothing to the posts
-- they already published -- those stayed publicly visible in Search,
-- RecentPosts, and their tenant blog. Close that gap at the source
-- (posts RLS) so every public-facing consumer is fixed at once, rather
-- than patching each frontend query separately.
--
-- Org members keep seeing everything in their org regardless of author
-- status (is_org_member branch untouched) -- they still need to be able
-- to find and unpublish/delete a disabled member's posts themselves.
--
-- is_author_disabled() has to be security definer: a plain subquery
-- against profiles here would itself be subject to profiles' own RLS
-- (self-only + is_site_admin), so for anon/other-org callers it would
-- always see zero rows and "not exists" would always be true, silently
-- defeating the whole check -- the same class of bug is_org_member etc.
-- already exist to avoid, just via a raw subquery instead of a PostgREST
-- embed this time.
create or replace function public.is_author_disabled(target_author_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select coalesce((select disabled from public.profiles where id = target_author_id), false);
$$;

drop policy "Published posts are public, org members see all" on public.posts;

create policy "Published posts by active authors are public, org members see all"
  on public.posts for select
  using (
    (status = 'published' and not public.is_author_disabled(author_id))
    or public.is_org_member(organization_id)
  );
