import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCreativeMemoryEvent } from "@/lib/creative-memory/server";
import type { Database, Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";

export async function recordDirectorPreference(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  artistId: string;
  signal: string;
  positive: boolean;
  projectId: string;
  releaseId?: string | null;
  trackId?: string | null;
  momentId?: string | null;
  assetId?: string | null;
  shotId?: string | null;
  generationId?: string | null;
  note?: string | null;
}) {
  const clean = input.signal.trim().slice(0, 240);
  if (!clean) return;
  return recordCreativeMemoryEvent({
    db: input.db as unknown as SupabaseClient<Database>,
    ownerId: input.ownerId,
    artistId: input.artistId,
    eventType: "preference_signal",
    sentiment: input.positive ? 1 : -1,
    weight: 2.5,
    signal: clean,
    source: "video_director",
    assetId: input.assetId ?? null,
    releaseId: input.releaseId ?? null,
    trackId: input.trackId ?? null,
    momentId: input.momentId ?? null,
    videoProjectId: input.projectId,
    idempotencyKey: `video-preference:${input.projectId}:${input.generationId ?? input.shotId ?? "project"}:${input.positive}:${clean.toLowerCase()}`,
    context: {
      shot_id: input.shotId ?? null,
      generation_id: input.generationId ?? null,
      note: input.note?.trim().slice(0, 500) || null,
    } satisfies Json,
  });
}
