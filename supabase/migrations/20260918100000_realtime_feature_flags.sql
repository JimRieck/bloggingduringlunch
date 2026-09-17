-- Realtime only pushes postgres_changes for tables explicitly added to
-- this publication -- without it, useFeatureFlags()'s subscription
-- would connect successfully but never actually receive an event.
alter publication supabase_realtime add table public.feature_flags;
