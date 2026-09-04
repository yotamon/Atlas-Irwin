-- Moments v2: fusion is evidence for curation, not another artist-facing proposal.
--
-- Base audio, lyric and stem Moments remain durable raw intelligence. The application curator
-- clusters those rows, promotes machine micro-windows to trustworthy musical-section boundaries,
-- and uses cross-source agreement as a ranking boost. Persisting every pairwise intersection as a
-- separate fused Moment multiplied candidates and frequently shortened complete sections into
-- unusable 3-8 second fragments.

create or replace function private.refresh_fused_track_moments(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Preserve artist decisions. Only machine-proposed fused rows are retired; approved rows remain
  -- durable history and keep their downstream lineage intact.
  update public.moments
  set state = 'superseded', updated_at = now()
  where track_id = p_track_id
    and source_mode = 'fused'
    and state = 'proposed';
end;
$$;
revoke all on function private.refresh_fused_track_moments(uuid) from public, anon, authenticated;

-- Clean up existing machine-generated fused proposals immediately. Nothing is deleted: the rows
-- remain available as historical evidence, while the artist workflow stops surfacing them.
update public.moments
set state = 'superseded', updated_at = now()
where source_mode = 'fused'
  and state = 'proposed';
