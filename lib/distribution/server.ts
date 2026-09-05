import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveDistributionArtistState, type DistributionArtistState } from "@/lib/distribution/artist-facing";
import type { Database } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

export async function loadDistributionArtistState(
  client: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  releaseId: string,
): Promise<DistributionArtistState | null> {
  const db = client as unknown as SupabaseClient<DistributionDatabase>;
  const [releaseResult, tracksResult, configResult, releaseMetaResult, metadataResult, writersResult, contributorsResult, profilesResult, issuesResult] = await Promise.all([
    db.from("releases").select("*").eq("id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle(),
    db.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle(),
    db.from("distribution_release_metadata").select("*").eq("release_id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle(),
    db.from("distribution_track_metadata").select("*").eq("owner_id", ownerId).eq("artist_id", artistId),
    db.from("distribution_track_writers").select("*").eq("owner_id", ownerId).eq("artist_id", artistId),
    db.from("distribution_track_contributors").select("*").eq("owner_id", ownerId).eq("artist_id", artistId),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", ownerId).eq("artist_id", artistId),
    db.from("distribution_validation_issues").select("*").eq("release_id", releaseId).eq("owner_id", ownerId).eq("artist_id", artistId).in("status", ["open", "acknowledged"]),
  ]);
  for (const result of [releaseResult, tracksResult, configResult, releaseMetaResult, metadataResult, writersResult, contributorsResult, profilesResult, issuesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!releaseResult.data) return null;
  const tracks = tracksResult.data ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  return deriveDistributionArtistState({
    release: releaseResult.data,
    tracks,
    config: configResult.data,
    releaseMetadata: releaseMetaResult.data,
    trackMetadata: (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    writers: (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    contributors: (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    artistProfiles: (profilesResult.data ?? []).filter((row) => row.artist_name === releaseResult.data.artist),
    openIssues: issuesResult.data ?? [],
  });
}
