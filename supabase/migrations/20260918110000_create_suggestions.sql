-- Suggestion box: any logged-in user can submit one, a site admin can
-- see all of them and set a status; the status set triggers an email
-- to the submitter (handled in the update-suggestion-status Edge
-- Function, not here -- a plain RLS-protected table has no way to send
-- email itself).
create type public.suggestion_status as enum ('new', 'under_review', 'planned', 'completed', 'declined');

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  status public.suggestion_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.suggestions enable row level security;

create policy "Users can create their own suggestions"
  on public.suggestions for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own suggestions"
  on public.suggestions for select
  using (auth.uid() = user_id);

create policy "Site admins can view all suggestions"
  on public.suggestions for select
  using (public.is_site_admin());

create policy "Site admins can update suggestion status"
  on public.suggestions for update
  using (public.is_site_admin())
  with check (public.is_site_admin());

grant select, insert, update on public.suggestions to authenticated;
