-- Auto-save in the post editor (PostForm.jsx, every 30 seconds).
--
-- 1. A draft's address follows its title until it's first published.
--    Auto-save creates a new post's row 30 seconds in, usually mid-title;
--    a slug fixed at insert (as before) would leave that half-typed title
--    in the post's permanent URL. Once a post has been published its
--    slug never changes again -- even if it's unpublished and retitled
--    later -- because its link may already be shared. Every existing post
--    counts as locked, so no existing address changes.
--
-- 2. Published posts auto-save to a private pending copy
--    (post_pending_edits), not to the post itself: readers keep seeing
--    the published version until the author clicks Publish. A separate
--    table rather than extra columns on posts, because anyone can read a
--    published post's row.

alter table public.posts
  add column slug_locked boolean not null default false;

update public.posts set slug_locked = true;

-- The slug for a title: lowercase words joined by dashes, with a number
-- added when another post in the same blog already has it.
create or replace function public.post_slug_for(p_organization_id uuid, p_title text, p_post_id uuid)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  base_slug := trim(both '-' from lower(regexp_replace(coalesce(p_title, ''), '[^a-zA-Z0-9]+', '-', 'g')));
  if base_slug = '' then
    base_slug := 'post';
  end if;

  final_slug := base_slug;
  while exists (
    select 1 from public.posts
    where organization_id = p_organization_id
      and slug = final_slug
      and id is distinct from p_post_id
  ) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;
  return final_slug;
end;
$$;

-- Same as before on insert, and a post published straight away is
-- locked at once.
create or replace function public.set_post_slug()
returns trigger
language plpgsql
as $$
begin
  if new.slug is null or trim(new.slug) = '' then
    new.slug := public.post_slug_for(new.organization_id, new.title, new.id);
  end if;
  if new.status = 'published' then
    new.slug_locked := true;
  end if;
  return new;
end;
$$;

create or replace function public.update_post_slug()
returns trigger
language plpgsql
as $$
begin
  -- Nobody unlocks a slug by writing to the column directly.
  new.slug_locked := old.slug_locked or new.status = 'published';
  if not old.slug_locked and new.title is distinct from old.title then
    new.slug := public.post_slug_for(new.organization_id, new.title, new.id);
  end if;
  return new;
end;
$$;

create trigger update_post_slug
  before update on public.posts
  for each row execute function public.update_post_slug();

-- One pending copy per post: what the author is working on, saved
-- automatically, not yet live.
create table public.post_pending_edits (
  post_id uuid primary key references public.posts(id) on delete cascade,
  title text not null,
  description text check (description is null or char_length(description) <= 150),
  content text not null default '',
  thumbnail_url text,
  updated_at timestamptz not null default now()
);

create trigger set_post_pending_edits_updated_at
  before update on public.post_pending_edits
  for each row execute function public.set_updated_at();

alter table public.post_pending_edits enable row level security;

-- Exactly the people who can edit the post itself (owners, admins and
-- editors of its blog) -- nobody else, readers included, ever sees it.
create policy "Editors can see pending edits to their organization's posts"
  on public.post_pending_edits for select
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_org_editor(p.organization_id)
  ));

create policy "Editors can save pending edits to their organization's posts"
  on public.post_pending_edits for insert
  with check (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_org_editor(p.organization_id)
  ));

create policy "Editors can update pending edits to their organization's posts"
  on public.post_pending_edits for update
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_org_editor(p.organization_id)
  ))
  with check (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_org_editor(p.organization_id)
  ));

create policy "Editors can discard pending edits to their organization's posts"
  on public.post_pending_edits for delete
  using (exists (
    select 1 from public.posts p
    where p.id = post_id and public.is_org_editor(p.organization_id)
  ));

-- No anon grant: a pending copy is never public.
grant select, insert, update, delete on public.post_pending_edits to authenticated;
grant select, insert, update, delete on public.post_pending_edits to service_role;
