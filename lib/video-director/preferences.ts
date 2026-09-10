import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCreativeMemoryEvent, upsertCreativeAssetProfile } from "@/lib/creative-memory/server";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { Database, Json } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import { parseVideoCreativeBrief } from "./domain";

export async function recordDirectorPreference(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  artistId?: string | null;
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

  const { data: project, error: projectError } = await input.db.from("music_video_projects")
    .select("release_id,track_id,creative_brief")
    .eq("id", input.projectId)
    .eq("owner_id", input.ownerId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found for Creative Memory.");

  const musicDb = input.db as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  let releaseQuery = musicDb.from("releases")
    .select("artist_id")
    .eq("id", input.releaseId ?? project.release_id)
    .eq("owner_id", input.ownerId);
  if (input.artistId) releaseQuery = releaseQuery.eq("artist_id", input.artistId);
  const { data: release, error: releaseError } = await releaseQuery.single();
  if (releaseError || !release) throw new Error(releaseError?.message || "Video feedback cannot be attached to an artist.");

  let assetId = input.assetId ?? null;
  if (!assetId && input.generationId) {
    const { data: generation, error: generationError } = await input.db.from("music_video_generations")
      .select("result_asset_id")
      .eq("id", input.generationId)
      .eq("project_id", input.projectId)
      .eq("owner_id", input.ownerId)
      .maybeSingle();
    if (generationError) throw new Error(generationError.message);
    assetId = generation?.result_asset_id ?? null;
  }

  const brief = parseVideoCreativeBrief(project.creative_brief);
  const artistId = release.artist_id;
  const releaseId = input.releaseId ?? project.release_id;
  const trackId = input.trackId ?? project.track_id;
  const momentId = input.momentId ?? brief.anchor_moment_id;
  const db = input.db as unknown as SupabaseClient<Database>;

  await recordCreativeMemoryEvent({
    db,
    ownerId: input.ownerId,
    artistId,
    eventType: "preference_signal",
    sentiment: input.positive ? 1 : -1,
    weight: 2.5,
    signal: clean,
    source: "video_director",
    assetId,
    releaseId,
    trackId,
    momentId,
    videoProjectId: input.projectId,
    idempotencyKey: `video-preference:${input.projectId}:${input.generationId ?? input.shotId ?? "project"}:${input.positive}:${clean.toLowerCase()}`,
    context: {
      shot_id: input.shotId ?? null,
      generation_id: input.generationId ?? null,
      note: input.note?.trim().slice(0, 500) || null,
    } satisfies Json,
  });

  if (assetId && input.generationId) {
    await upsertCreativeAssetProfile({
      db,
      ownerId: input.ownerId,
      artistId,
      assetId,
      semanticDescriptors: [clean],
      brandRelevance: input.positive ? 0.65 : 0.35,
      evidence: {
        source: "video_director_review",
        project_id: input.projectId,
        shot_id: input.shotId ?? null,
        generation_id: input.generationId,
      },
      reviewed: true,
    });
    await recordCreativeMemoryEvent({
      db,
      ownerId: input.ownerId,
      artistId,
      eventType: input.positive ? "shot_locked" : "shot_rejected",
      sentiment: input.positive ? 1 : -1,
      weight: 4,
      signal: clean,
      source: "video_director",
      assetId,
      releaseId,
      trackId,
      momentId,
      videoProjectId: input.projectId,
      idempotencyKey: `video-shot-review:${input.generationId}:${input.positive ? "locked" : "rejected"}`,
      context: {
        shot_id: input.shotId ?? null,
        generation_id: input.generationId,
        note: input.note?.trim().slice(0, 500) || null,
      } satisfies Json,
    });
  }
}
