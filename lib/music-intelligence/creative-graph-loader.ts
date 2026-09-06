import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTrackLyricsContext, type TrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import { parseMusicMap } from "@/lib/video-director/creative-director";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { AudioScene, StemDatabase, TrackStem } from "@/types/stem-database";
import {
  buildTrackCreativeIntelligenceGraph,
  type TrackCreativeIntelligenceGraph,
} from "./creative-graph";

export async function loadTrackCreativeIntelligenceGraph(
  db: SupabaseClient,
  trackId: string,
  ownerId: string,
  knownLyrics?: TrackLyricsContext,
): Promise<TrackCreativeIntelligenceGraph | null> {
  const stemDb = db as unknown as SupabaseClient<StemDatabase>;
  const lyricsDb = db as unknown as SupabaseClient<LyricsDatabase>;
  const [musicResult, stemsResult, scenesResult, lyrics] = await Promise.all([
    stemDb.from("track_music_intelligence")
      .select("analysis")
      .eq("track_id", trackId)
      .eq("owner_id", ownerId)
      .maybeSingle(),
    stemDb.from("track_stems")
      .select("*")
      .eq("track_id", trackId)
      .eq("owner_id", ownerId)
      .eq("status", "ready")
      .order("display_order"),
    stemDb.from("audio_scenes")
      .select("*")
      .eq("track_id", trackId)
      .eq("owner_id", ownerId)
      .eq("status", "ready")
      .order("is_pinned", { ascending: false })
      .order("score", { ascending: false, nullsFirst: false }),
    knownLyrics
      ? Promise.resolve(knownLyrics)
      : loadTrackLyricsContext(lyricsDb, trackId, ownerId),
  ]);
  const error = musicResult.error || stemsResult.error || scenesResult.error;
  if (error) throw new Error(error.message);
  return buildTrackCreativeIntelligenceGraph({
    musicMap: parseMusicMap(musicResult.data?.analysis),
    lyrics,
    stems: (stemsResult.data ?? []) as TrackStem[],
    scenes: (scenesResult.data ?? []) as AudioScene[],
  });
}
