-- Public catalog reads use the low-privilege Supabase publishable/anon role.
-- Row Level Security remains the authoritative filter for which rows are public.

grant select on table
  public.releases,
  public.homepage_placements,
  public.tracks,
  public.media_links,
  public.media_assets,
  public.release_external_links,
  public.track_external_ids
to anon;
