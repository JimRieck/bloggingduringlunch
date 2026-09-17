-- A client bug (BulkAutoTag.jsx reading stale React state across an
-- async loop instead of a locally-threaded value, fixed alongside this
-- migration) let the AI auto-tag bulk run re-create the same category
-- name over and over for a single org, since (organization_id, slug)
-- was the only uniqueness ever enforced -- and the slug trigger
-- auto-suffixes on a collision instead of rejecting a repeat name, so
-- duplicate *names* were never actually blocked. This cleans up
-- whatever duplicates already exist, then adds the constraint that
-- should have been there from the start.

-- Repoint any post_categories row pointing at a duplicate to the
-- canonical (oldest) row for that (organization_id, name) instead,
-- skipping a post that's already linked to the canonical row too (that
-- pairing would otherwise violate post_categories' own primary key).
with ranked as (
  select id, organization_id, name,
         row_number() over (partition by organization_id, name order by created_at, id) as rn
  from public.categories
),
canonical as (
  select organization_id, name, id as canonical_id
  from ranked
  where rn = 1
),
dupes as (
  select r.id as dupe_id, c.canonical_id
  from ranked r
  join canonical c on c.organization_id = r.organization_id and c.name = r.name
  where r.rn > 1
)
update public.post_categories pc
set category_id = d.canonical_id
from dupes d
where pc.category_id = d.dupe_id
  and not exists (
    select 1 from public.post_categories pc2
    where pc2.post_id = pc.post_id and pc2.category_id = d.canonical_id
  );

-- Whatever's left pointing at a duplicate is a post that was already
-- linked to the canonical row too -- just drop the now-redundant link
-- rather than leaving it dangling once the duplicate row is deleted.
with ranked as (
  select id, organization_id, name,
         row_number() over (partition by organization_id, name order by created_at, id) as rn
  from public.categories
),
canonical as (
  select organization_id, name, id as canonical_id
  from ranked
  where rn = 1
),
dupes as (
  select r.id as dupe_id
  from ranked r
  join canonical c on c.organization_id = r.organization_id and c.name = r.name
  where r.rn > 1
)
delete from public.post_categories pc
using dupes d
where pc.category_id = d.dupe_id;

with ranked as (
  select id, organization_id, name,
         row_number() over (partition by organization_id, name order by created_at, id) as rn
  from public.categories
)
delete from public.categories c
using ranked r
where c.id = r.id and r.rn > 1;

alter table public.categories
  add constraint categories_organization_id_name_key unique (organization_id, name);
