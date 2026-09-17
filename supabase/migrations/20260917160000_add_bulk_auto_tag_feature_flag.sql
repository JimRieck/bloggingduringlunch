-- Separate from ai_tag_generation/ai_category_generation: those gate the
-- underlying suggest-tags-and-categories calls themselves (used by both
-- the per-post editor and this bulk screen), but running it across an
-- entire backlog in one click is a much bigger cost spike than a single
-- post -- worth its own on/off switch so bulk mode specifically can be
-- turned off without touching per-post suggestions.
insert into public.feature_flags (key, enabled) values
  ('ai_bulk_auto_tag', false);
