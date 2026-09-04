-- Auto-generate a post's slug from its title, server-side, the same
-- way organization slugs are generated in handle_new_user -- the
-- client never sends a slug, so there's nothing for it to get wrong
-- or collide on by accident.
create or replace function public.set_post_slug()
returns trigger
language plpgsql
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 0;
begin
  if new.slug is null or trim(new.slug) = '' then
    base_slug := trim(both '-' from lower(regexp_replace(new.title, '[^a-zA-Z0-9]+', '-', 'g')));
    if base_slug = '' then
      base_slug := 'post';
    end if;

    final_slug := base_slug;
    while exists (
      select 1 from public.posts
      where organization_id = new.organization_id and slug = final_slug
    ) loop
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    end loop;

    new.slug := final_slug;
  end if;
  return new;
end;
$$;

create trigger set_post_slug
  before insert on public.posts
  for each row execute function public.set_post_slug();
