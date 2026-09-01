-- Subscriptions: one billing row per organization. Placeholder until
-- Stripe is wired up; deliberately not client-writable (see below).
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy "Members can view their organization's subscription"
  on public.subscriptions for select
  using (public.is_org_member(organization_id));

grant select on public.subscriptions to authenticated;
-- Deliberately no insert/update/delete policy or grant for `authenticated`:
-- subscription state must only ever be written by a trusted server-side
-- process (a future Stripe-webhook Supabase Edge Function) using the
-- service_role key, which bypasses RLS entirely. This keeps billing state
-- fully non-client-writable even before Stripe is wired up.

-- Every org gets a 'free' subscription row the moment it's created, so the
-- future Stripe webhook can always UPDATE an existing row rather than
-- branching on INSERT-vs-UPDATE.
create or replace function public.handle_new_organization_subscription()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.subscriptions (organization_id, plan, status)
  values (new.id, 'free', 'active');
  return new;
end;
$$;

create trigger on_organization_created_subscription
  after insert on public.organizations
  for each row execute function public.handle_new_organization_subscription();
