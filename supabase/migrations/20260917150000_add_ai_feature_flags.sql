-- One row per AI feature, toggled independently -- e.g. the priciest one
-- (image generation) can be switched off without touching the others.
-- Readable by anyone so both the client (to hide disabled UI) and every
-- AI Edge Function (to refuse the call server-side too, not just trust
-- the client to hide the button) can check it; only a site admin can
-- flip one, via a direct update to this table.
create table public.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;

create policy "Anyone can read feature flags"
  on public.feature_flags for select
  using (true);

create policy "Site admins can update feature flags"
  on public.feature_flags for update
  using (public.is_site_admin())
  with check (public.is_site_admin());

grant select on public.feature_flags to anon, authenticated;
grant update on public.feature_flags to authenticated;

insert into public.feature_flags (key, enabled) values
  ('ai_tag_generation', false),
  ('ai_category_generation', false),
  ('ai_title_generation', false),
  ('ai_body_generation', false),
  ('ai_image_generation', false);
