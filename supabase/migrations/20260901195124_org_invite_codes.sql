-- Replace "pick any organization from a public list and self-join as
-- a read-only member" with a proper invite-code flow: joining an
-- existing org now requires knowing its (unguessable, not publicly
-- listed) invite code, and grants 'editor' -- someone invited to
-- write actually gets to write, unlike the old 'member' default.
alter table public.organizations
  add column invite_code text unique not null
    default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);

-- Lets the (unauthenticated, mid-registration) client validate an
-- invite code and show which org it belongs to, before creating the
-- account -- so a typo'd code fails fast in the form instead of
-- leaving a signed-up user stranded with no organization. Returns
-- only the org's name; the invite_code column itself is never
-- exposed to anon/authenticated roles (organizations' base RLS still
-- requires membership to select it directly).
create or replace function public.lookup_invite_code(code text)
returns table(organization_id uuid, organization_name text)
language sql
security definer
set search_path = public
stable
as $$
  select id, name from public.organizations where invite_code = code;
$$;

grant execute on function public.lookup_invite_code(text) to anon, authenticated;

-- Extend handle_new_user again: authors now join an existing org via
-- invite_code (resolved server-side) instead of organization_id, and
-- get 'editor' rather than 'member' so they can actually write posts.
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
    select id into reader_org_id from public.organizations where slug = 'bdlreaders';
    if reader_org_id is null then
      insert into public.organizations (name, slug, owner_id)
      values ('BDLReaders', 'bdlreaders', new.id)
      returning id into reader_org_id;
    else
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
    -- The client validates the code via lookup_invite_code() before
    -- calling signUp, so a code that doesn't resolve here should be
    -- rare (e.g. a race). If it happens, the account is still
    -- created with no organization rather than failing signup.
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
