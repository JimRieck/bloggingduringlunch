-- A cross-org user directory (for a new /directory page). This
-- intentionally sees every user regardless of organization -- the
-- base tables' RLS is scoped per-org (is_org_member etc.), so a
-- normal authenticated query can't see other orgs' members at all.
-- Like organizations_public, this view is owned by the migration
-- role and so bypasses that RLS, exposing only the columns needed
-- for the directory.
--
-- Gated to `authenticated` only (not `anon`): you must be logged in
-- to view it. There's no separate "platform admin" role yet, so any
-- logged-in user (reader or author) can currently see every other
-- user's email, avatar, and organization -- fine for now as an
-- internal tool on a small/personal instance, but worth tightening
-- to a real admin check before this is a public multi-tenant site.
create view public.user_directory as
select
  p.id,
  p.email,
  p.display_name,
  p.avatar_url,
  p.user_type,
  coalesce(string_agg(o.name, ', ' order by o.name), '—') as organizations
from public.profiles p
left join public.memberships m on m.user_id = p.id
left join public.organizations o on o.id = m.organization_id
group by p.id, p.email, p.display_name, p.avatar_url, p.user_type
order by p.email;

grant select on public.user_directory to authenticated;
