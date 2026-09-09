-- Site admins need to see traffic across every org for the new
-- site-wide stats chart on the admin page. The existing select policy
-- on post_views only covers "org members can see their posts' views",
-- so an admin querying a post outside their own org would get nothing
-- back. Adds a second, permissive select policy (RLS policies for the
-- same command OR together) mirroring the one already granted for
-- profiles in 20260907174053_add_site_admin.sql.
create policy "Site admins can view all post views"
  on public.post_views for select
  using (public.is_site_admin());
