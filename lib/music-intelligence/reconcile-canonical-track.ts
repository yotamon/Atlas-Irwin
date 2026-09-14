import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeTrackLyrics } from "@/lib/lyrics-intelligence/analyze";
import {
  asStemClient,
  regenerateSystemAudioScenes,
} from "@/lib/music-intelligence/stem-scenes";
import type { Database } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { StemDatabase, TrackStem } from "@/types/stem-database";

export type LyricsReconciliationState =
  | {
      state: "ready";
      alignedSections: number;
      alignedLines: number;
      moments: number;
      semanticCacheHit: boolean;
    }
  | {
      state: "needs_input";
      reason: "official_lyrics_missing" | "ai_context_disabled";
    }
  | {
      state: "skipped";
      reason: "instrumental";
    }
  | {
      state: "failed";
      message: string;
    };

export type StemReconciliationState =
  | {
      state: "ready";
      readyStems: number;
      audioScenes: number;
    }
  | {
      state: "processing";
      stems: number;
    }
  | {
      state: "needs_input";
      reason: "stems_from_previous_master";
      stems: number;
    }
  | {
      state: "skipped";
      reason: "no_stems";
    }
  | {
      state: "failed";
      message: string;
    };

export type CanonicalTrackReconciliation = {
  trackId: string;
  releaseId: string;
  lyrics: LyricsReconciliationState;
  stems: StemReconciliationState;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function reconcileCanonicalTrackIntelligence({
  client,
  trackId,
  expectedOwnerId,
}: {
  client: SupabaseClient<Database>;
  trackId: string;
  expectedOwnerId?: string;
}): Promise<CanonicalTrackReconciliation> {
  let trackQuery = client
    .from("tracks")
    .select("id,owner_id,release_id,audio_url")
    .eq("id", trackId);
  if (expectedOwnerId) trackQuery = trackQuery.eq("owner_id", expectedOwnerId);
  const trackResult = await trackQuery.maybeSingle();
  if (trackResult.error) throw new Error(trackResult.error.message);
  if (!trackResult.data) throw new Error("Track not found.");
  if (!trackResult.data.audio_url) throw new Error("Track has no canonical master.");

  const track = trackResult.data;
  const lyricsDb = client as unknown as SupabaseClient<LyricsDatabase>;
  const stemsDb = asStemClient(client) as SupabaseClient<StemDatabase>;
  const [lyricsResult, stemsResult] = await Promise.all([
    lyricsDb
      .from("track_lyrics")
      .select("id,status,allow_ai_context")
      .eq("track_id", track.id)
      .eq("owner_id", track.owner_id)
      .maybeSingle(),
    stemsDb
      .from("track_stems")
      .select("*")
      .eq("track_id", track.id)
      .eq("owner_id", track.owner_id),
  ]);
  if (lyricsResult.error) throw new Error(lyricsResult.error.message);
  if (stemsResult.error) throw new Error(stemsResult.error.message);

  let lyrics: LyricsReconciliationState;
  if (!lyricsResult.data) {
    lyrics = { state: "needs_input", reason: "official_lyrics_missing" };
  } else if (lyricsResult.data.status === "instrumental") {
    lyrics = { state: "skipped", reason: "instrumental" };
  } else if (!lyricsResult.data.allow_ai_context) {
    lyrics = { state: "needs_input", reason: "ai_context_disabled" };
  } else {
    try {
      const result = await analyzeTrackLyrics({
        db: lyricsDb,
        ownerId: track.owner_id,
        trackId: track.id,
        releaseId: track.release_id,
        cacheMode: "use",
      });
      lyrics = {
        state: "ready",
        alignedSections: result.alignedSections,
        alignedLines: result.alignedLines,
        moments: result.moments,
        semanticCacheHit: result.cacheHit,
      };
    } catch (error) {
      lyrics = {
        state: "failed",
        message: errorMessage(error, "Lyrics Intelligence reconciliation failed."),
      };
    }
  }

  const stems = (stemsResult.data ?? []) as TrackStem[];
  const currentMasterStems = stems.filter((stem) => stem.source_master_url === track.audio_url);
  const readyStems = currentMasterStems.filter((stem) => stem.status === "ready");
  let stemState: StemReconciliationState;

  if (!stems.length) {
    stemState = { state: "skipped", reason: "no_stems" };
  } else if (!currentMasterStems.length) {
    stemState = {
      state: "needs_input",
      reason: "stems_from_previous_master",
      stems: stems.length,
    };
  } else if (!readyStems.length) {
    stemState = { state: "processing", stems: currentMasterStems.length };
  } else {
    try {
      const scenes = await regenerateSystemAudioScenes({
        client,
        ownerId: track.owner_id,
        trackId: track.id,
      });
      stemState = {
        state: "ready",
        readyStems: readyStems.length,
        audioScenes: scenes.length,
      };
    } catch (error) {
      stemState = {
        state: "failed",
        message: errorMessage(error, "Stem Intelligence reconciliation failed."),
      };
    }
  }

  return {
    trackId: track.id,
    releaseId: track.release_id,
    lyrics,
    stems: stemState,
  };
}
