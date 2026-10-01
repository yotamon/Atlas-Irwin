import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveMasterReadiness, type MasterReadiness } from "@/lib/mastering/readiness";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { describeTrackAnalysis } from "@/lib/studio/track-analysis-state";
import type { Database } from "@/types/database";

type TrackAudioIdentity = {
  id: string;
  audio_url: string | null;
};

export async function loadMasterReadinessByTrack(
  client: SupabaseClient<Database>,
  ownerId: string,
  artistId: string,
  tracks: TrackAudioIdentity[],
): Promise<Record<string, MasterReadiness>> {
  const result: Record<string, MasterReadiness> = {};
  if (!tracks.length) return result;

  const ids = tracks.map((track) => track.id);
  const growth = asGrowthClient(client);
  const vaultResult = await growth.from("track_vault")
    .select("id,linked_track_id,audio_url,media_asset_id,audio_profile,analysis,updated_at")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .in("linked_track_id", ids)
    .order("updated_at", { ascending: false });
  if (vaultResult.error) throw new Error(vaultResult.error.message);

  const byTrack = new Map<string, (typeof vaultResult.data)[number]>();
  for (const row of vaultResult.data ?? []) {
    if (row.linked_track_id && !byTrack.has(row.linked_track_id)) byTrack.set(row.linked_track_id, row);
  }

  for (const track of tracks) {
    const vault = byTrack.get(track.id);
    if (!vault) {
      result[track.id] = deriveMasterReadiness({}, {
        audioUrl: track.audio_url,
        mediaAssetId: null,
      });
      continue;
    }
    const analysis = describeTrackAnalysis(vault.analysis, vault.audio_profile);
    result[track.id] = deriveMasterReadiness(vault.audio_profile, {
      // Distribution verifies the exact audio URL on the canonical release track.
      // If the vault points at a different waveform the shared readiness contract becomes stale.
      audioUrl: track.audio_url,
      mediaAssetId: null,
      analysisActive: analysis.isActive && !analysis.hasMusicMap,
      analysisFailed: analysis.needsRecovery && !analysis.hasMusicMap,
    });
  }

  return result;
}

