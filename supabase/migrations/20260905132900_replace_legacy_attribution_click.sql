-- The legacy attribution RPC changed its table return shape in the Smart Links migration.
-- PostgreSQL cannot change an existing function return type with CREATE OR REPLACE,
-- so remove the old signature immediately before recreating it privacy-safe.
drop function if exists public.record_attribution_click(text,text,text,text);
