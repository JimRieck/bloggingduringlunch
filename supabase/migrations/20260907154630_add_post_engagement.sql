-- Post engagement: views (anonymous-friendly, feeds author-facing stats),
-- star ratings and comments (both require login to write, but are
-- publicly readable -- same as every blog commenting/rating system).

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
-- No user_id: a view is traffic, not an account action, and should count
-- for anonymous readers too. Anyone can insert one, but only for a post
-- that's actually published (no tracking noise on drafts, and no way to
-- probe for the existence of a hidden/unpublished post's id this way).
create table public.post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  referrer text,
  viewed_at timestamptz not null default now()
);

create index post_views_post_id_idx on public.post_views (post_id, viewed_at desc);

alter table public.post_views enable row level security;

create policy "Anyone can record a view on a published post"
  on public.post_views for insert
  with check (
    exists (select 1 from public.posts where id = post_id and status = 'published')
  );

create policy "Org members can see their posts' views"
  on public.post_views for select
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_org_member(p.organization_id)
    )
  );

grant insert on public.post_views to anon, authenticated;
grant select on public.post_views to authenticated;

-- ---------------------------------------------------------------------
-- Star ratings
-- ---------------------------------------------------------------------
-- One rating per user per post (unique constraint below), upserted --
-- rating again just changes your existing rating, matching how every
-- star-rating UI (Amazon, Yelp, ...) actually works.
create table public.post_ratings (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create index post_ratings_post_id_idx on public.post_ratings (post_id);

create trigger set_post_ratings_updated_at
  before update on public.post_ratings
  for each row execute function public.set_updated_at();

alter table public.post_ratings enable row level security;

-- Raw per-user ratings are not public (that's what post_rating_summary
-- below is for) -- only your own, or, for the org that owns the post,
-- all of them (this is the actual author-facing stats data).
create policy "Users see their own rating, org members see all"
  on public.post_ratings for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_org_member(p.organization_id)
    )
  );

create policy "Logged-in users can rate a published post"
  on public.post_ratings for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts where id = post_id and status = 'published')
  );

create policy "Users can change their own rating"
  on public.post_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Users can remove their own rating"
  on public.post_ratings for delete
  using (user_id = auth.uid());

grant select, insert, update, delete on public.post_ratings to authenticated;

-- Public, read-only aggregate -- this is what a post page actually shows
-- to any visitor (average + count), without exposing who rated what.
create view public.post_rating_summary as
select
  post_id,
  round(avg(rating)::numeric, 1) as average_rating,
  count(*) as rating_count
from public.post_ratings
group by post_id;

grant select on public.post_rating_summary to anon, authenticated;

-- ---------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index post_comments_post_id_idx on public.post_comments (post_id, created_at);

create trigger set_post_comments_updated_at
  before update on public.post_comments
  for each row execute function public.set_updated_at();

alter table public.post_comments enable row level security;

-- Comments are public by nature (like the post itself) -- readable by
-- anyone, same "published posts only" gate as everything else here.
create policy "Comments on published posts are public"
  on public.post_comments for select
  using (
    exists (select 1 from public.posts where id = post_id and status = 'published')
  );

create policy "Logged-in users can comment on a published post"
  on public.post_comments for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.posts where id = post_id and status = 'published')
  );

create policy "Users can edit their own comment"
  on public.post_comments for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- The commenter can remove their own comment; an org admin can remove
-- anyone's (moderation), matching the existing owner/admin-can-delete
-- pattern already used for posts.
create policy "Own comment or org admin can delete"
  on public.post_comments for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_org_admin(p.organization_id)
    )
  );

grant select on public.post_comments to anon, authenticated;
grant insert, update, delete on public.post_comments to authenticated;

-- Minimal public identity for attributing a comment to its author --
-- deliberately narrower than user_directory (no email), since this one
-- is readable by anonymous visitors, not just logged-in users.
create view public.public_profiles as
select id, display_name, avatar_url
from public.profiles;

grant select on public.public_profiles to anon, authenticated;
