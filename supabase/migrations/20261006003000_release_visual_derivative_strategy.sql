alter table public.creative_derivatives
  drop constraint if exists creative_derivatives_strategy_check;

alter table public.creative_derivatives
  add constraint creative_derivatives_strategy_check
  check (strategy in (
    'reuse_approved_image',
    'deterministic_image_recompose',
    'deterministic_video_repackage'
  ));
