import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProductionProfilePreviews } from "@/lib/video-director/profile-preview";
import { loadVideoProjectContext, resolveProjectAudioUrl } from "@/lib/video-director/context";
import { projectMediaLinkScopeFilter } from "@/lib/video-director/media-scope";
import { openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { mediaWorkerReadiness } from "@/lib/video-director/worker";
import { higgsfieldReadiness } from "@/lib/video-providers/higgsfield/client";
import type { VideoWorkspaceData } from "@/components/studio/video-director/workspace-types";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { Database, Json, MediaAsset } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { StemDatabase } from "@/types/stem-database";
import type { VideoDatabase } from "@/types/video-database";

export class VideoWorkspaceNotFoundError extends Error {
  constructor(message = "Video workspace not found") {
    super(message);
    this.name = "VideoWorkspaceNotFoundError";
  }
}

function hasStructuredValue(value: unknown) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function strings(value: Json | unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueAssets(assets: MediaAsset[]) {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()];
}

function higgsfieldUsdPerCredit() {
  const value = Number(process.env.HIGGSFIELD_USD_PER_CREDIT);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isMissingVideoContext(error: unknown) {
  if (!(error instanceof Error)) return false;
  return /not found|does not belong to the active artist/i.test(error.message);
}

export async function loadVideoWorkspaceSnapshot(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  projectId: string;
}): Promise<VideoWorkspaceData> {
  const videoDb = input.db as unknown as SupabaseClient<VideoDatabase>;
  const musicDb = input.db as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  const lyricsDb = input.db as unknown as SupabaseClient<LyricsDatabase>;
  const stemDb = input.db as unknown as SupabaseClient<StemDatabase>;

  let context;
  try {
    context = await loadVideoProjectContext(videoDb, input.projectId, input.ownerId, input.artistId);
  } catch (error) {
    if (isMissingVideoContext(error)) throw new VideoWorkspaceNotFoundError();
    throw error;
  }

  const { project, release, track, creativeMemory } = context;
  const [
    conceptsResult,
    scenesResult,
    shotsResult,
    charactersResult,
    generationsResult,
    approvalsResult,
    rendersResult,
    workerJobsResult,
    mediaLinksResult,
    thumbnailAssetsResult,
    lyricsResult,
    stemsResult,
    audioScenesResult,
  ] = await Promise.all([
    videoDb.from("music_video_concepts").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId)
      .order("round_number", { ascending: false }).order("display_order"),
    videoDb.from("music_video_scenes").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("display_order"),
    videoDb.from("music_video_shots").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("display_order"),
    videoDb.from("music_video_characters").select("*").eq("artist_id", input.artistId).eq("owner_id", input.ownerId).order("created_at"),
    videoDb.from("music_video_generations").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("created_at"),
    videoDb.from("music_video_approvals").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("created_at", { ascending: false }),
    videoDb.from("music_video_renders").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("created_at", { ascending: false }),
    videoDb.from("music_video_worker_jobs").select("*").eq("project_id", project.id).eq("owner_id", input.ownerId).order("created_at", { ascending: false }).limit(50),
    musicDb.from("media_links").select("id,media_asset_id,role,release_id,track_id,artist_id")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId)
      .or(projectMediaLinkScopeFilter(project.release_id, project.track_id)),
    input.db.from("media_assets").select("*")
      .eq("owner_id", input.ownerId)
      .eq("asset_type", "thumbnail")
      .contains("metadata", { project_id: project.id })
      .order("created_at"),
    lyricsDb.from("track_lyrics").select("id,version,status")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("track_id", project.track_id).maybeSingle(),
    stemDb.from("track_stems").select("id,category,label,status,duration_ms,analysis")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("track_id", project.track_id).order("display_order"),
    stemDb.from("audio_scenes").select("id,name,scene_type,description,recommended_start_ms,recommended_end_ms,score")
      .eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("track_id", project.track_id).eq("status", "ready").order("score", { ascending: false }),
  ]);

  const firstError = [
    conceptsResult.error,
    scenesResult.error,
    shotsResult.error,
    charactersResult.error,
    generationsResult.error,
    approvalsResult.error,
    rendersResult.error,
    workerJobsResult.error,
    mediaLinksResult.error,
    thumbnailAssetsResult.error,
    lyricsResult.error,
    stemsResult.error,
    audioScenesResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const lyricLinesResult = lyricsResult.data && lyricsResult.data.status !== "instrumental"
    ? await lyricsDb.from("track_lyric_lines").select("id,section_id,text,allow_media,start_ms,end_ms")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("lyrics_id", lyricsResult.data.id)
      .eq("lyrics_version", lyricsResult.data.version)
      .order("display_order")
    : { data: [], error: null };
  if (lyricLinesResult.error) throw new Error(lyricLinesResult.error.message);

  const lyricCues = (lyricLinesResult.data ?? []).flatMap((line) =>
    line.start_ms !== null && line.end_ms !== null && line.end_ms > line.start_ms
      ? [{
        id: line.id,
        text: line.text,
        startMs: line.start_ms,
        endMs: line.end_ms,
        sectionId: line.section_id,
        allowMedia: line.allow_media,
      }]
      : [],
  );

  const shots = shotsResult.data ?? [];
  const productionProfilePreviews = await buildProductionProfilePreviews({ project, shots });
  const characters = charactersResult.data ?? [];
  const generations = generationsResult.data ?? [];
  const renders = rendersResult.data ?? [];
  const mediaLinks = mediaLinksResult.data ?? [];
  const linkedAssetIds = mediaLinks.map((link) => link.media_asset_id);
  const characterAssetIds = characters.flatMap((character) => [
    ...strings(character.reference_asset_ids),
    ...strings(character.approved_asset_ids),
  ]);
  const assetIds = [...new Set([
    ...linkedAssetIds,
    ...characterAssetIds,
    ...creativeMemory.recommendations.map((recommendation) => recommendation.assetId),
    ...generations.flatMap((generation) => generation.result_asset_id ? [generation.result_asset_id] : []),
    ...renders.flatMap((render) => render.media_asset_id ? [render.media_asset_id] : []),
    ...shots.flatMap((shot) => [
      shot.start_asset_id,
      shot.end_asset_id,
      shot.selected_asset_id,
      ...strings(shot.reference_asset_ids),
    ].filter((assetId): assetId is string => Boolean(assetId))),
  ])];
  const referencedAssetsResult = assetIds.length
    ? await input.db.from("media_assets").select("*").eq("owner_id", input.ownerId).in("id", assetIds)
    : { data: [] as MediaAsset[], error: null };
  if (referencedAssetsResult.error) throw new Error(referencedAssetsResult.error.message);
  const assets = uniqueAssets([...(referencedAssetsResult.data ?? []), ...(thumbnailAssetsResult.data ?? [])]);

  const projectRoles = new Set(mediaLinks
    .filter((link) => link.track_id === project.track_id || (link.track_id === null && link.release_id === project.release_id))
    .map((link) => link.role));
  const hasAudio = Boolean(track.audio_url) || projectRoles.has("master_audio") || projectRoles.has("audio_preview");
  const hasArtwork = Boolean(release.artwork_url) || projectRoles.has("cover") || projectRoles.has("alternate_artwork");
  const audioUrl = hasAudio ? await resolveProjectAudioUrl(videoDb, project, input.ownerId, input.artistId) : null;
  const higgsfield = higgsfieldReadiness();

  return {
    project,
    release,
    track,
    audioUrl,
    concepts: conceptsResult.data ?? [],
    scenes: scenesResult.data ?? [],
    shots,
    characters,
    lyricCues,
    stems: (stemsResult.data ?? []).map((stem) => ({
      id: stem.id,
      category: stem.category,
      label: stem.label,
      status: stem.status,
      durationMs: stem.duration_ms,
      analysis: stem.analysis,
    })),
    audioScenes: (audioScenesResult.data ?? []).map((scene) => ({
      id: scene.id,
      name: scene.name,
      sceneType: scene.scene_type,
      description: scene.description,
      startMs: scene.recommended_start_ms,
      endMs: scene.recommended_end_ms,
      score: scene.score === null ? null : Number(scene.score),
    })),
    generations,
    approvals: approvalsResult.data ?? [],
    renders,
    workerJobs: workerJobsResult.data ?? [],
    assets,
    productionProfilePreviews,
    creativeMemory: {
      summary: creativeMemory.summary,
      evidenceCount: creativeMemory.evidenceCount,
      recommendations: creativeMemory.recommendations,
    },
    services: {
      director: openAIDirectorReadiness(),
      higgsfield: { ...higgsfield, usdPerCredit: higgsfieldUsdPerCredit() },
      worker: mediaWorkerReadiness(),
    },
    contextSignals: {
      hasAudio,
      hasArtwork,
      hasReleaseIdentity: hasStructuredValue(release.release_identity),
    },
  };
}
