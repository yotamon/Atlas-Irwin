-- Atlas Video Director budget transaction idempotency
--
-- Provider callbacks and server retries are at-least-once by nature. These RPCs therefore
-- make repeated reserve/settle calls safe and refuse contradictory terminal settlements.

create or replace function public.reserve_music_video_generation(
  p_generation_id uuid
) returns public.music_video_generations
language plpgsql security invoker set search_path = '' as $$
declare
  g public.music_video_generations;
  a public.music_video_approvals;
  p public.music_video_projects;
begin
  select * into g from public.music_video_generations
    where id = p_generation_id for update;
  if g.id is null then raise exception 'Generation not found'; end if;

  -- A retry after a successful reserve must be a no-op, never a second reservation.
  if g.billing_status = 'reserved' then
    if g.status = 'approved' then return g; end if;
    raise exception 'Generation has a reserved budget in unexpected status %', g.status;
  end if;
  if g.billing_status <> 'unconfirmed' then
    raise exception 'Generation budget is already settled as %', g.billing_status;
  end if;
  if g.status <> 'planned' then
    raise exception 'Generation cannot be reserved from status %', g.status;
  end if;
  if g.approval_id is null then raise exception 'Paid generation requires approval'; end if;

  select * into a from public.music_video_approvals
    where id = g.approval_id for update;
  if a.id is null or a.project_id <> g.project_id or a.owner_id <> g.owner_id then
    raise exception 'Invalid approval';
  end if;
  if a.status <> 'active' then raise exception 'Approval is not active'; end if;
  if a.expires_at is not null and a.expires_at <= now() then raise exception 'Approval expired'; end if;
  if not private.music_video_scope_allows_generation(a.scope, g.id, g.shot_id, g.operation_type, g.model) then
    raise exception 'Generation falls outside approved scope';
  end if;
  if a.consumed_credits + a.reserved_credits + g.estimated_credits > a.max_credits then
    raise exception 'Approval credit envelope exceeded';
  end if;

  select * into p from public.music_video_projects
    where id = g.project_id for update;
  if p.id is null then raise exception 'Project not found'; end if;
  if p.owner_id <> g.owner_id then raise exception 'Project owner does not match generation owner'; end if;
  if p.status in ('archived', 'failed') then raise exception 'Project cannot spend credits in current status'; end if;
  if p.spent_credits + p.reserved_credits + g.estimated_credits > p.hard_budget_credits then
    raise exception 'Project hard budget exceeded';
  end if;

  update public.music_video_approvals
    set reserved_credits = reserved_credits + g.estimated_credits
    where id = a.id;
  update public.music_video_projects
    set reserved_credits = reserved_credits + g.estimated_credits
    where id = p.id;
  update public.music_video_generations
    set status = 'approved', billing_status = 'reserved'
    where id = g.id
    returning * into g;
  return g;
end $$;

create or replace function public.settle_music_video_generation(
  p_generation_id uuid,
  p_actual_credits numeric,
  p_billing_status text default 'charged'
) returns public.music_video_generations
language plpgsql security invoker set search_path = '' as $$
declare
  g public.music_video_generations;
  a public.music_video_approvals;
  p public.music_video_projects;
  reserve_amount numeric;
  charge_amount numeric;
begin
  if p_actual_credits < 0 then raise exception 'Actual credits cannot be negative'; end if;
  if p_billing_status not in ('charged', 'not_billed', 'refunded') then
    raise exception 'Invalid billing status';
  end if;

  select * into g from public.music_video_generations
    where id = p_generation_id for update;
  if g.id is null then raise exception 'Generation not found'; end if;

  -- Replaying the exact same terminal settlement is safe. A conflicting settlement is not.
  if g.billing_status in ('charged', 'not_billed', 'refunded') then
    if g.billing_status = p_billing_status
      and coalesce(g.actual_credits, 0) = p_actual_credits then
      return g;
    end if;
    raise exception 'Generation already settled as %', g.billing_status;
  end if;
  if g.billing_status <> 'reserved' then
    raise exception 'Generation has no reserved budget to settle';
  end if;

  reserve_amount := g.estimated_credits;
  charge_amount := case when p_billing_status = 'charged' then p_actual_credits else 0 end;

  select * into p from public.music_video_projects
    where id = g.project_id for update;
  if p.id is null then raise exception 'Project not found'; end if;
  if p.owner_id <> g.owner_id then raise exception 'Project owner does not match generation owner'; end if;
  if p.spent_credits + greatest(0, p.reserved_credits - reserve_amount) + charge_amount > p.hard_budget_credits then
    raise exception 'Settlement would exceed project hard budget';
  end if;

  if g.approval_id is not null then
    select * into a from public.music_video_approvals
      where id = g.approval_id for update;
    if a.id is null or a.project_id <> g.project_id or a.owner_id <> g.owner_id then
      raise exception 'Invalid approval during settlement';
    end if;
    if a.consumed_credits + greatest(0, a.reserved_credits - reserve_amount) + charge_amount > a.max_credits then
      raise exception 'Settlement would exceed approval credit envelope';
    end if;
  end if;

  update public.music_video_projects
    set reserved_credits = greatest(0, reserved_credits - reserve_amount),
        spent_credits = spent_credits + charge_amount
    where id = g.project_id;

  if g.approval_id is not null then
    update public.music_video_approvals
      set reserved_credits = greatest(0, reserved_credits - reserve_amount),
          consumed_credits = consumed_credits + charge_amount,
          status = case
            when consumed_credits + charge_amount >= max_credits then 'consumed'
            else status
          end
      where id = g.approval_id;
  end if;

  update public.music_video_generations
    set actual_credits = p_actual_credits,
        billing_status = p_billing_status
    where id = g.id
    returning * into g;
  return g;
end $$;

grant execute on function public.reserve_music_video_generation(uuid) to authenticated;
grant execute on function public.settle_music_video_generation(uuid, numeric, text) to authenticated;
