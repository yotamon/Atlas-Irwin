-- Explicit grants for the immutable creative-lineage surface. RLS remains the
-- authorization boundary and limits authenticated Studio users to accessible artists.
-- No client-facing execution grant is given for private learning refresh/ranking
-- functions; those remain internal database decision primitives.
grant select, insert on public.creative_recipes to authenticated;
grant select on public.verified_moment_learning_evidence to authenticated;
grant select on public.verified_creative_learning_evidence to authenticated;
