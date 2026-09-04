-- Explicit grants for the immutable creative-lineage surface. RLS remains the
-- read authorization boundary and limits authenticated Studio users to accessible artists.
-- Creative recipes are causal history, so clients may inspect them but only trusted
-- security-definer lineage triggers may create them.
revoke insert, update, delete on public.creative_recipes from authenticated;
grant select on public.creative_recipes to authenticated;

-- No client-facing execution grant is given for private learning refresh/ranking
-- functions; those remain internal database decision primitives.
grant select on public.verified_moment_learning_evidence to authenticated;
grant select on public.verified_creative_learning_evidence to authenticated;
