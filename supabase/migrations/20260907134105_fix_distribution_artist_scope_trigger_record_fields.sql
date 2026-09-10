create or replace function private.validate_distribution_artist_scope()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  expected uuid;
  linked uuid;
begin
  expected := new.artist_id;

  if tg_table_name in ('release_distribution_configs','distribution_submissions','distribution_deliveries','distribution_validation_issues','distribution_provider_operations') then
    select artist_id into linked from public.releases where id = new.release_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception '% artist must match release artist', tg_table_name;
    end if;
  elsif tg_table_name in ('distribution_track_metadata','distribution_track_writers','distribution_track_contributors') then
    select r.artist_id into linked
    from public.tracks t
    join public.releases r on r.id = t.release_id
    where t.id = new.track_id;
    expected := coalesce(expected, linked);
    if linked is null or expected <> linked then
      raise exception '% artist must match track release artist', tg_table_name;
    end if;
  elsif tg_table_name = 'distribution_events' then
    if new.release_id is not null then
      select artist_id into linked from public.releases where id = new.release_id;
      expected := coalesce(expected, linked);
      if linked is null or expected <> linked then
        raise exception 'Distribution event artist must match release artist';
      end if;
    end if;
    if new.submission_id is not null then
      select artist_id into linked from public.distribution_submissions where id = new.submission_id;
      expected := coalesce(expected, linked);
      if linked is null or expected <> linked then
        raise exception 'Distribution event artist must match submission artist';
      end if;
    end if;
  end if;

  -- Keep table-specific NEW fields inside table-specific branches. Referencing a
  -- field that does not exist on the trigger relation raises before boolean
  -- short-circuiting can protect it.
  if tg_table_name = 'distribution_deliveries' then
    if new.submission_id is not null then
      select artist_id into linked from public.distribution_submissions where id = new.submission_id;
      if linked is null or expected <> linked then
        raise exception 'Distribution delivery submission must belong to delivery artist';
      end if;
    end if;
  end if;

  if tg_table_name = 'distribution_validation_issues' then
    if new.submission_id is not null then
      select artist_id into linked from public.distribution_submissions where id = new.submission_id;
      if linked is null or expected <> linked then
        raise exception 'Distribution issue submission must belong to issue artist';
      end if;
    end if;
  end if;

  if expected is null then
    expected := private.legacy_artist_for_owner(new.owner_id);
  end if;

  perform private.assert_operational_artist_owner(new.owner_id, expected);
  new.artist_id := expected;
  return new;
end;
$function$;
