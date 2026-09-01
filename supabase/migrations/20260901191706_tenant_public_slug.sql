-- Expose slug on the public organizations listing so the frontend can
-- resolve "<slug>.bloggingduringlunch.com" to an organization without
-- needing to be authenticated (visiting a tenant's blog is public).
create or replace view public.organizations_public as
select id, name, slug
from public.organizations
order by name;
