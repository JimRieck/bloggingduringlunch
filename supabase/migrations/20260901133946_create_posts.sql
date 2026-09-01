-- Posts: organization-scoped blog content.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  title text not null,
  slug text not null,
  content text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create index posts_org_status_published_idx
  on public.posts (organization_id, status, published_at desc);

create trigger set_posts_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Public (anon) can read published posts only; org members can read
-- everything in their org including drafts.
create policy "Published posts are public, org members see all"
  on public.posts for select
  using (status = 'published' or public.is_org_member(organization_id));

create policy "Editors can create posts in their organization"
  on public.posts for insert
  with check (
    public.is_org_editor(organization_id)
    and author_id = auth.uid()
  );

create policy "Editors can update posts in their organization"
  on public.posts for update
  using (public.is_org_editor(organization_id))
  with check (public.is_org_editor(organization_id));

create policy "Admins can delete posts in their organization"
  on public.posts for delete
  using (public.is_org_admin(organization_id));

grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
