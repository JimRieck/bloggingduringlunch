-- Shows/hides the editor's "Write with AI" button next to a post's
-- description (suggest-post-description refuses the call too while it's
-- off). Off until a site admin switches it on from /admin, like every
-- other AI feature.
insert into public.feature_flags (key, enabled) values
  ('ai_description_generation', false)
on conflict (key) do nothing;
