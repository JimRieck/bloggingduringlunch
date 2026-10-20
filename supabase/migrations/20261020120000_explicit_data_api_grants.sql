-- Supabase stops granting Data API access to new tables in "public"
-- automatically on 2026-10-30 (existing projects; already the default
-- for new ones). Until now every table and view here got
-- select/insert/update/delete for anon, authenticated and service_role
-- from the schema's default privileges, and most of our migrations
-- relied on that without granting anything themselves.
--
-- Production's existing tables keep their grants, so nothing changes
-- there. What would break is replaying the migrations from scratch --
-- CI's local stack, `supabase db reset`, preview branches -- where every
-- table below would come up unreachable through supabase-js. So this
-- spells out the access each one has today. On production it grants
-- nothing new.
--
-- What a role may actually do is still decided by each table's RLS
-- policies, exactly as before; these grants only let the Data API reach
-- the table at all.

-- Tables and views that never had grants of their own. Same Data API
-- access as they've always had through the defaults.
grant select, insert, update, delete on
  public.categories,
  public.feature_flags,
  public.memberships,
  public.organizations,
  public.post_categories,
  public.post_comments,
  public.post_images,
  public.post_ratings,
  public.post_tags,
  public.post_views,
  public.posts,
  public.profiles,
  public.subscriptions,
  public.suggestions,
  public.tags,
  public.organizations_public,
  public.post_rating_summary,
  public.public_profiles,
  public.user_directory,
  public.user_directory_admin
to anon, authenticated;

-- The tables with their own, narrower grants (ai_usage_events,
-- announcements, bot_visits, linkedin_connections, linkedin_oauth_states,
-- scheduled_social_posts, social_post_runs) set anon/authenticated
-- themselves but left service_role -- which the Edge Functions write
-- with -- to the defaults. Every relation gets it explicitly.
grant select, insert, update, delete on all tables in schema public to service_role;

-- And stop the automatic grants now rather than on Oct 30, so local
-- development, CI and production all behave the new way from today: a
-- table created by a later migration gets no Data API access until that
-- migration grants it (see CLAUDE.md). The same two statements Supabase
-- applies to existing projects. Functions are unaffected.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
