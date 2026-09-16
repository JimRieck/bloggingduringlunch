-- Categories are shared org-wide (every author on the same blog picks
-- from the same list, same as WordPress's own per-site taxonomy).
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

-- Tags are private per author -- the unique constraint is scoped to
-- author_id, not organization_id, which is what actually stops two
-- authors on the same org from ever sharing a tag.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  unique (author_id, slug)
);

create table public.post_categories (
  post_id uuid not null references public.posts(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (post_id, category_id)
);

create table public.post_tags (
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (post_id, tag_id)
);

-- Same auto-slug-from-name pattern as set_post_slug, just scoped to
-- organization_id instead of nothing.
create or replace function public.set_category_slug()
returns trigger
language plpgsql
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if new.slug is null or trim(new.slug) = '' then
    base_slug := trim(both '-' from lower(regexp_replace(new.name, '[^a-zA-Z0-9]+', '-', 'g')));
    if base_slug = '' then
      base_slug := 'category';
    end if;

    final_slug := base_slug;
    while exists (
      select 1 from public.categories
      where organization_id = new.organization_id and slug = final_slug
    ) loop
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    end loop;

    new.slug := final_slug;
  end if;
  return new;
end;
$$;

create trigger set_category_slug
  before insert on public.categories
  for each row execute function public.set_category_slug();

-- Same pattern again, scoped to author_id instead of organization_id.
create or replace function public.set_tag_slug()
returns trigger
language plpgsql
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if new.slug is null or trim(new.slug) = '' then
    base_slug := trim(both '-' from lower(regexp_replace(new.name, '[^a-zA-Z0-9]+', '-', 'g')));
    if base_slug = '' then
      base_slug := 'tag';
    end if;

    final_slug := base_slug;
    while exists (
      select 1 from public.tags
      where author_id = new.author_id and slug = final_slug
    ) loop
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    end loop;

    new.slug := final_slug;
  end if;
  return new;
end;
$$;

create trigger set_tag_slug
  before insert on public.tags
  for each row execute function public.set_tag_slug();

alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.post_categories enable row level security;
alter table public.post_tags enable row level security;

-- Same shape as the tags policy below: org members see the whole
-- shared list (needed for the post editor's checklist), but a public
-- reader can also see a specific category if it's attached to a post
-- they can already see -- otherwise an anonymous visitor would never
-- see category names on a published post at all.
create policy "Org members see all categories; others see categories on a visible post"
  on public.categories for select
  using (
    public.is_org_member(organization_id)
    or exists (
      select 1 from public.post_categories pc
      join public.posts p on p.id = pc.post_id
      where pc.category_id = categories.id
        and (p.status = 'published' or public.is_org_member(p.organization_id))
    )
  );

create policy "Editors can create categories in their organization"
  on public.categories for insert
  with check (public.is_org_editor(organization_id));

-- security definer, same reasoning as is_author_disabled() elsewhere in
-- this project: a plain subquery here would itself be subject to
-- post_tags'/posts' own RLS, and since post_tags' own policies (below)
-- check back against tags, a plain subquery in both directions is a
-- genuine infinite loop ("infinite recursion detected in policy for
-- relation tags/post_tags", hit and fixed before this shipped, not
-- guessed at) -- not just a style choice. Bypassing RLS on the *inner*
-- query here is what breaks the cycle; the other direction (post_tags'
-- policies checking tags.author_id) stays a plain subquery below, since
-- breaking the cycle at one crossing point is enough.
create or replace function public.tag_on_visible_post(check_tag_id uuid)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists (
    select 1 from post_tags pt
    join posts p on p.id = pt.post_id
    where pt.tag_id = check_tag_id
      and (p.status = 'published' or is_org_member(p.organization_id))
  );
$$;

-- Wider than it first looks: the owning author sees their whole tag
-- vocabulary (needed for the edit-post autocomplete list, including
-- tags not yet attached to anything published), but anyone else can
-- only ever discover a *specific* tag by way of a post they can
-- already see it attached to (published, or their own org) -- never
-- by browsing another author's full tag list. That's what actually
-- keeps tags private between authors while still letting a public
-- reader see the tag names printed on a published post.
create policy "Authors see their own tags; others see tags on a visible post"
  on public.tags for select
  using (
    author_id = auth.uid()
    or public.tag_on_visible_post(id)
  );

create policy "Authors can create their own tags"
  on public.tags for insert
  with check (author_id = auth.uid());

-- Mirrors posts' own select policy: published posts are public, org
-- members see everything (including a draft's categories).
create policy "Post categories are visible wherever the post itself is"
  on public.post_categories for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_categories.post_id
        and (p.status = 'published' or public.is_org_member(p.organization_id))
    )
  );

create policy "Editors can manage a post's categories"
  on public.post_categories for all
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_categories.post_id and public.is_org_editor(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_categories.post_id and public.is_org_editor(p.organization_id)
    )
  );

create policy "Post tags are visible wherever the post itself is"
  on public.post_tags for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_tags.post_id
        and (p.status = 'published' or public.is_org_member(p.organization_id))
    )
  );

-- Deliberately narrower than post_categories: only the post's own
-- author can attach tags to it, and only their own tags -- an editor
-- who isn't the author can still edit the post itself, just not its
-- (private) tags. This is the real enforcement of "tags are
-- per-author," not just a client-side UI convention.
--
-- Split into insert/delete specifically (not `for all`, which would
-- also cover select): the `tags` select policy above already queries
-- post_tags, so a `for all` policy here -- applying to select too --
-- would query tags right back, and Postgres has no way to resolve that
-- cycle ("infinite recursion detected in policy for relation tags",
-- caught by this migration's own test file before this shipped, not
-- guessed at). post_tags' select policy is deliberately left to the
-- other policy above, which only references posts, not tags.
create policy "A post's own author can attach its tags"
  on public.post_tags for insert
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_tags.post_id and p.author_id = auth.uid()
    )
    and exists (
      select 1 from public.tags t
      where t.id = post_tags.tag_id and t.author_id = auth.uid()
    )
  );

create policy "A post's own author can remove its tags"
  on public.post_tags for delete
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_tags.post_id and p.author_id = auth.uid()
    )
  );

grant select, insert on public.categories to authenticated;
grant select, insert on public.tags to authenticated;
grant select, insert, delete on public.post_categories to authenticated;
grant select, insert, delete on public.post_tags to authenticated;
grant select on public.post_categories, public.post_tags to anon;
grant select on public.categories, public.tags to anon;
