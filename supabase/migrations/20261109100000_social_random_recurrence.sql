-- "Random" social posting: a schedule that posts a randomly chosen blog
-- post several times a day until an end date. Its own migration because
-- Postgres can't use a new enum value in the same transaction that adds
-- it; 20261109100100_random_social_schedules.sql builds on it.
alter type public.social_recurrence add value if not exists 'random';
