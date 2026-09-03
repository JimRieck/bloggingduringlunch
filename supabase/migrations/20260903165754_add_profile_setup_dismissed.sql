-- Lets a user dismiss the "finish setting up your profile" (avatar)
-- prompt so it doesn't keep reappearing on every visit if they'd
-- rather skip it.
alter table public.profiles add column profile_setup_dismissed boolean not null default false;
