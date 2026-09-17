-- Categories could be created (by an org editor) but never deleted --
-- needed now that duplicates/mistakes are something a user might
-- actually want to clean up by hand. Mirrors the existing insert
-- policy's is_org_editor gate exactly; post_categories rows referencing
-- a deleted category are already cleaned up automatically via that
-- table's own `on delete cascade`.
create policy "Editors can delete categories in their organization"
  on public.categories for delete
  using (public.is_org_editor(organization_id));

grant delete on public.categories to authenticated;
