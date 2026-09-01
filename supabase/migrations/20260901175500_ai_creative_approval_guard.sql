create or replace function private.guard_ai_content_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  latest_output jsonb;
begin
  if new.source <> 'ai' or new.approval_status <> 'approved' then
    return new;
  end if;
  if old.approval_status = 'approved' then
    return new;
  end if;

  select gr.output
    into latest_output
  from public.generation_runs gr
  where gr.owner_id = new.owner_id
    and gr.purpose = 'content_asset:' || new.id::text
    and gr.status = 'completed'
  order by gr.created_at desc
  limit 1;

  if latest_output is null then
    raise exception 'AI creative cannot be approved without completed generation lineage.';
  end if;
  if coalesce(latest_output->>'stage', '') <> 'creative_review' then
    raise exception 'AI creative cannot be approved before deterministic finishing and automated quality control pass.';
  end if;
  if coalesce(latest_output #>> '{visualQuality,passed}', 'false') <> 'true' then
    raise exception 'AI creative cannot be approved because automated visual quality control has not passed.';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_ai_content_approval() from public, anon, authenticated;
grant execute on function private.guard_ai_content_approval() to service_role;

drop trigger if exists guard_ai_content_approval on public.content_items;
create trigger guard_ai_content_approval
  before update of approval_status on public.content_items
  for each row execute function private.guard_ai_content_approval();
