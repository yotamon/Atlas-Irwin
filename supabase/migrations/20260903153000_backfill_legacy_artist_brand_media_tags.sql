-- Ensemblis #71 rollout compatibility: media_assets remain workspace-owned, but reusable
-- brand/approved-library references are selected through an explicit artist tag. All reference
-- media that predates multi-artist support belongs deterministically to the legacy/default artist
-- for that owner. Tag it once so Atlas keeps its current visual identity after the stricter reads.

update public.media_assets m
set metadata = jsonb_set(
  coalesce(m.metadata, '{}'::jsonb),
  '{tags}',
  (
    select coalesce(jsonb_agg(to_jsonb(tag_value)), '[]'::jsonb)
    from (
      select distinct tag_value
      from (
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(m.metadata, '{}'::jsonb)->'tags') = 'array'
              then coalesce(m.metadata, '{}'::jsonb)->'tags'
            else '[]'::jsonb
          end
        ) as tag_value
        union all
        select 'artist:' || private.legacy_artist_for_owner(m.owner_id)::text
      ) tags
      where tag_value is not null and btrim(tag_value) <> ''
    ) deduped
  ),
  true
)
where private.legacy_artist_for_owner(m.owner_id) is not null
  and (
    m.asset_type in ('brand_reference', 'brand_logo', 'brand_motion_reference')
    or exists (
      select 1
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(m.metadata, '{}'::jsonb)->'tags') = 'array'
            then coalesce(m.metadata, '{}'::jsonb)->'tags'
          else '[]'::jsonb
        end
      ) tag(tag_value)
      where lower(tag.tag_value) in (
        'atlas-brand',
        'brand-reference',
        'visual-language',
        'approved-reference',
        'approved-creative'
      )
    )
  )
  and not exists (
    select 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(coalesce(m.metadata, '{}'::jsonb)->'tags') = 'array'
          then coalesce(m.metadata, '{}'::jsonb)->'tags'
        else '[]'::jsonb
      end
    ) tag(tag_value)
    where lower(tag.tag_value) = lower('artist:' || private.legacy_artist_for_owner(m.owner_id)::text)
  );
