-- Every user is marked as a 'reader' or an 'author' at signup.
alter table public.profiles
  add column user_type text not null default 'author' check (user_type in ('reader', 'author'));

-- Extend handle_new_user (defined in create_profiles.sql, previously
-- extended in signup_organization_provisioning.sql) to branch on the
-- account type chosen at signup:
--   - 'reader': no organization choice in the UI at all -- readers are
--     auto-joined to a single shared "BDLReaders" organization
--     (created on first use, exactly like any other org), so the
--     existing membership/RLS model keeps working uniformly without a
--     separate "follower" concept.
--   - 'author' (default, unchanged from before): join the chosen
--     existing org as 'member', or create a new one as 'owner'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_type text;
  reader_org_id uuid;
  chosen_org_id uuid;
  new_org_name text;
  new_org_id uuid;
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  account_type := coalesce(new.raw_user_meta_data ->> 'user_type', 'author');

  insert into public.profiles (id, email, display_name, user_type)
  values (new.id, new.email, new.raw_user_meta_data ->> 'username', account_type);

  if account_type = 'reader' then
    select id into reader_org_id from public.organizations where slug = 'bdlreaders';
    if reader_org_id is null then
      insert into public.organizations (name, slug, owner_id)
      values ('BDLReaders', 'bdlreaders', new.id)
      returning id into reader_org_id;
      -- owner membership + free subscription auto-created by the
      -- existing triggers on organizations insert.
    else
      insert into public.memberships (organization_id, user_id, role)
      values (reader_org_id, new.id, 'member')
      on conflict (organization_id, user_id) do nothing;
    end if;
    return new;
  end if;

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
  end if;

  return new;
end;
$$;
