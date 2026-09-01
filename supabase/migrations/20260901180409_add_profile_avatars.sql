-- Profile avatars: a column to point at the stored image, plus a
-- Storage bucket to hold it.
alter table public.profiles add column avatar_url text;

-- Public bucket so avatars can be displayed anywhere (e.g. a future
-- blog byline) without signed URLs. Public only means readable by
-- anyone with the URL -- write access is still restricted by the
-- policies below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- One folder per user (path = "<user_id>/<filename>"), the standard
-- Supabase Storage convention: anyone can view, but a user can only
-- write into their own folder.
create policy "Avatar images are publicly viewable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
