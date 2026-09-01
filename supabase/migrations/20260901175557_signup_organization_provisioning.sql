-- Public-safe listing of organizations for the registration dropdown.
-- Anonymous visitors (not yet signed up) need to see org names to pick
-- one to join, but the base `organizations` table's RLS restricts
-- select to existing members. This view is owned by the migration
-- role (which bypasses RLS as the table owner) and exposes only the
-- columns needed for that dropdown -- not owner_id or timestamps.
create view public.organizations_public as
select id, name
from public.organizations
order by name;

grant select on public.organizations_public to anon, authenticated;

-- Extend handle_new_user (defined in create_profiles.sql) to also
-- provision an organization at signup time, based on optional
-- metadata passed via supabase.auth.signUp's `options.data`:
--   - organization_id: join this existing org as 'member'
--   - new_organization_name: create a new org (becomes 'owner' via
--     the existing handle_new_organization trigger) when no
--     organization_id was given
-- Doing this inside the trigger (rather than a client-side call after
-- signUp) means it works the same whether or not email confirmation
-- is required, since the trigger fires at user-creation time
-- regardless of confirmation status.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_org_id uuid;
  new_org_name text;
  new_org_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'username');

  chosen_org_id := nullif(new.raw_user_meta_data ->> 'organization_id', '')::uuid;
  new_org_name := nullif(trim(new.raw_user_meta_data ->> 'new_organization_name'), '');

  if chosen_org_id is not null then
    insert into public.memberships (organization_id, user_id, role)
    values (chosen_org_id, new.id, 'member')
    on conflict (organization_id, user_id) do nothing;
  elsif new_org_name is not null then
    base_slug := trim(both '-' from lower(regexp_replace(new_org_name, '[^a-zA-Z0-9]+', '-', 'g')));
    final_slug := base_slug;
    while exists (select 1 from public.organizations where slug = final_slug) loop
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    end loop;

    insert into public.organizations (name, slug, owner_id)
    values (new_org_name, final_slug, new.id)
    returning id into new_org_id;
    -- owner membership + free subscription auto-created by the
    -- existing triggers on organizations insert.
  end if;

  return new;
end;
$$;
