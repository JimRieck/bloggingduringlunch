-- Organizations (tenants/blogs) and memberships (per-org roles).
create type public.org_role as enum ('owner', 'admin', 'editor', 'member');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index memberships_user_id_idx on public.memberships (user_id);
create index memberships_org_id_idx on public.memberships (organization_id);

-- --- RLS helper functions -------------------------------------------------
-- A policy on `memberships` that queries `memberships` directly re-triggers
-- RLS evaluation on itself ("infinite recursion detected in policy for
-- relation memberships"). SECURITY DEFINER functions run as the function
-- owner (bypassing RLS for their own internal query) while still keying
-- strictly off auth.uid(), so they're safe to expose to any authenticated
-- caller.
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_org_editor(org_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from public.memberships
    where organization_id = org_id
      and user_id = auth.uid()
      and role in ('owner', 'admin', 'editor')
  );
$$;

-- Auto-add the creator as 'owner' whenever an organization is created.
-- Without this, a freshly-created org would have zero members able to
-- add anyone (the memberships insert policy below requires an existing
-- admin) -- a chicken-and-egg deadlock. SECURITY DEFINER bypasses that.
create or replace function public.handle_new_organization()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.memberships (organization_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

create trigger set_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;

-- organizations policies
create policy "Members can view their organizations"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "Users can create organizations they own"
  on public.organizations for insert
  with check (auth.uid() = owner_id);

create policy "Admins can update their organization"
  on public.organizations for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

create policy "Owner can delete their organization"
  on public.organizations for delete
  using (auth.uid() = owner_id);

grant select, insert, update, delete on public.organizations to authenticated;

-- memberships policies
create policy "Members can view fellow members"
  on public.memberships for select
  using (public.is_org_member(organization_id));

create policy "Admins can add members"
  on public.memberships for insert
  with check (public.is_org_admin(organization_id));

create policy "Admins can update member roles"
  on public.memberships for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy "Admins can remove members, members can leave"
  on public.memberships for delete
  using (public.is_org_admin(organization_id) or user_id = auth.uid());

grant select, insert, update, delete on public.memberships to authenticated;
