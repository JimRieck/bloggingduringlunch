-- Post images: a Storage bucket for thumbnails/inline body images, plus a
-- small per-organization media library table so a past upload can be
-- reused across posts instead of re-uploading it every time.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- One folder per org (path = "<organization_id>/<filename>"): anyone can
-- view, but only that org's editors can write into its folder.
create policy "Post images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'post-images');

create policy "Editors can upload their organization's post images"
  on storage.objects for insert
  with check (
    bucket_id = 'post-images'
    and public.is_org_editor((storage.foldername(name))[1]::uuid)
  );

create policy "Editors can update their organization's post images"
  on storage.objects for update
  using (
    bucket_id = 'post-images'
    and public.is_org_editor((storage.foldername(name))[1]::uuid)
  );

create policy "Editors can delete their organization's post images"
  on storage.objects for delete
  using (
    bucket_id = 'post-images'
    and public.is_org_editor((storage.foldername(name))[1]::uuid)
  );

create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  url text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index post_images_org_idx on public.post_images (organization_id, created_at desc);

alter table public.post_images enable row level security;

create policy "Org members can browse their organization's image library"
  on public.post_images for select
  using (public.is_org_member(organization_id));

create policy "Editors can add to their organization's image library"
  on public.post_images for insert
  with check (
    public.is_org_editor(organization_id)
    and uploaded_by = auth.uid()
  );

create policy "Editors can remove from their organization's image library"
  on public.post_images for delete
  using (public.is_org_editor(organization_id));

grant select, insert, delete on public.post_images to authenticated;

alter table public.posts add column thumbnail_url text;
