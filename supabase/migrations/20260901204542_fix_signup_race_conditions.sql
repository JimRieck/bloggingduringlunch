-- Fix two check-then-insert races in handle_new_user, found by the
-- bulk (50 concurrent-ish signups) integration test:
--
-- 1. Creating a new org: "does this slug exist? no -> insert it" is
--    not atomic. Two concurrent signups choosing the same org name
--    can both pass the check before either commits, so both insert
--    the same candidate slug -- one wins, the other fails outright
--    with "duplicate key value violates unique constraint
--    organizations_slug_key", which (since this runs inside the
--    auth.users insert's trigger) surfaces to the client as signup
--    itself failing ("Database error saving new user").
--
-- 2. The reader path has the same shape of race the first time
--    BDLReaders is created: two concurrent first-ever readers can
--    both see "it doesn't exist yet" and both try to insert it.
--
-- Fix: react to the actual unique-constraint violation Postgres
-- detects atomically, instead of trying to predict it with a
-- separate, non-atomic pre-check.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  account_type text;
  reader_org_id uuid;
  invite_code_input text;
  joined_org_id uuid;
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
    -- Try to atomically create BDLReaders; ON CONFLICT DO NOTHING
    -- means a losing concurrent insert just yields no row instead of
    -- erroring. If we won (reader_org_id got set), the owner-membership
    -- + subscription triggers already fired for us as its owner.
    insert into public.organizations (name, slug, owner_id)
    values ('BDLReaders', 'bdlreaders', new.id)
    on conflict (slug) do nothing
    returning id into reader_org_id;

    if reader_org_id is null then
      select id into reader_org_id from public.organizations where slug = 'bdlreaders';
      insert into public.memberships (organization_id, user_id, role)
      values (reader_org_id, new.id, 'member')
      on conflict (organization_id, user_id) do nothing;
    end if;
    return new;
  end if;

  invite_code_input := nullif(trim(new.raw_user_meta_data ->> 'invite_code'), '');
  new_org_name := nullif(trim(new.raw_user_meta_data ->> 'new_organization_name'), '');

  if invite_code_input is not null then
    select id into joined_org_id from public.organizations where invite_code = invite_code_input;
    if joined_org_id is not null then
      insert into public.memberships (organization_id, user_id, role)
      values (joined_org_id, new.id, 'editor')
      on conflict (organization_id, user_id) do nothing;
    end if;
  elsif new_org_name is not null then
    base_slug := trim(both '-' from lower(regexp_replace(new_org_name, '[^a-zA-Z0-9]+', '-', 'g')));
    final_slug := base_slug;

    -- Attempt the insert; if a concurrent transaction already took
    -- this exact slug, Postgres's own constraint check (atomic,
    -- unlike a separate pre-check) raises unique_violation -- catch
    -- it, bump the suffix, and retry with the next candidate.
    loop
      begin
        insert into public.organizations (name, slug, owner_id)
        values (new_org_name, final_slug, new.id)
        returning id into new_org_id;
        exit;
      exception when unique_violation then
        suffix := suffix + 1;
        final_slug := base_slug || '-' || suffix;
        if suffix > 50 then
          raise exception 'Could not find a free slug for organization "%"', new_org_name;
        end if;
      end;
    end loop;
  end if;

  return new;
end;
$$;
