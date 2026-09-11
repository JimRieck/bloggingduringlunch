-- Closes the gap the original user_directory_view migration flagged
-- as an accepted-for-now shortcut: "any logged-in user can currently
-- see every other user's email... worth tightening to a real admin
-- check." Asked for directly, alongside moving the /directory link
-- in NavPane.jsx under the new "Site Admin" section.
--
-- Deliberately a *new* view, not a `where is_site_admin()` added to
-- the existing public.user_directory: Search.jsx also queries
-- user_directory (id, display_name, avatar_url, organizations -- no
-- email) for its author-lookup results, available to any logged-in
-- user, not just admins. Restricting the shared view would have
-- silently broken that already-shipped feature. This adds email and
-- restricts to site admins only, for the /directory page specifically;
-- the original view is untouched and still backs Search.
create view public.user_directory_admin as
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
where public.is_site_admin()
group by p.id, p.email, p.display_name, p.avatar_url, p.user_type
order by p.email;

grant select on public.user_directory_admin to authenticated;
