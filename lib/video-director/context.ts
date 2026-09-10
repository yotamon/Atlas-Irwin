import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadArtistCreativeMemory } from "@/lib/creative-memory/server";
import { loadTrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import { conciseCreativeGraphContext, type TrackCreativeIntelligenceGraph } from "@/lib/music-intelligence/creative-graph";
import { loadTrackCreativeIntelligenceGraph } from "@/lib/music-intelligence/creative-graph-loader";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { ArtistScopedCoreOperationalDatabase } from "@/types/artist-scoped-operational-database";
import type { Database, Json } from "@/types/database";
import type { LyricsDatabase } from "@/types/lyrics-database";
import type { AudioScene, StemDatabase } from "@/types/stem-database";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import { parseMusicMap, type DirectorPreferences, type MusicMap, type VideoProjectContext } from "./creative-director";

function jsonRecord(value: Json | unknown): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stemAwareMusicMap(value: Json, scenes: AudioScene[], graph: TrackCreativeIntelligenceGraph | null) {
  const map = parseMusicMap(value);
  if (!map) return null;
  return {
    ...map,
    stem_intelligence: scenes.length ? {
      purpose: "Reusable stem-aware musical treatments. The full music video still follows the canonical master; use these scenes to inform musical causality, shot mechanics, edit motifs and derivative social concepts.",
      audio_scenes: scenes.slice(0, 10).map((scene) => ({
        id: scene.id,
        name: scene.name,
        type: scene.scene_type,
        description: scene.description,
        start_ms: scene.recommended_start_ms,
        end_ms: scene.recommended_end_ms,
        score: scene.score,
        objectives: scene.objective_tags,
        platform_hints: scene.platform_hints,
        is_pinned: scene.is_pinned,
        preview_ready: Boolean(scene.preview_asset_id),
        rationale: scene.rationale,
      })),
    } : undefined,
    creative_intelligence: conciseCreativeGraphContext(graph),
  } as MusicMap;
}

export async function loadVideoProjectContext(
  db: SupabaseClient<VideoDatabase>,
  projectId: string,
  ownerId: string,
  expectedArtistId?: string | null,
): Promise<VideoProjectContext & { project: ExtendedMusicVideoProject }> {
  const { data: project, error: projectError } = await db
    .from("music_video_projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .single();
  if (projectError || !project) throw new Error(projectError?.message || "Music video project not found.");

  const musicDb = db as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  const operationalDb = db as unknown as SupabaseClient<ArtistScopedCoreOperationalDatabase>;
  const stemDb = db as unknown as SupabaseClient<StemDatabase>;
  const lyricsDb = db as unknown as SupabaseClient<LyricsDatabase>;
  let releaseQuery = musicDb.from("releases").select("*")
    .eq("id", project.release_id)
    .eq("owner_id", ownerId);
  if (expectedArtistId) releaseQuery = releaseQuery.eq("artist_id", expectedArtistId);
  const releaseResult = await releaseQuery.single();
  if (releaseResult.error || !releaseResult.data) throw new Error(releaseResult.error?.message || "Release not found for this artist.");
  const artistId = releaseResult.data.artist_id;
  if (expectedArtistId && artistId !== expectedArtistId) throw new Error("Video project does not belong to the active artist.");

  const [trackResult, brandResult, linkResult, sceneResult, lyrics, creativeMemory] = await Promise.all([
    musicDb.from("tracks").select("*")
      .eq("id", project.track_id)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .single(),
    operationalDb.from("brand_settings").select("content")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .order("section"),
    musicDb.from("media_links").select("media_asset_id,release_id,track_id,role,artist_id")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`),
    stemDb.from("audio_scenes")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("track_id", project.track_id)
      .eq("status", "ready")
      .order("is_pinned", { ascending: false })
      .order("score", { ascending: false, nullsFirst: false }),
    loadTrackLyricsContext(lyricsDb, project.track_id, ownerId),
    loadArtistCreativeMemory({
      db: db as unknown as SupabaseClient<Database>,
      ownerId,
      artistId,
      releaseId: project.release_id,
      trackId: project.track_id,
      recommendationLimit: 8,
    }),
  ]);

  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found for this artist.");
  if (trackResult.data.release_id !== releaseResult.data.id) throw new Error("Video track does not belong to the project release.");
  if (brandResult.error) throw new Error(brandResult.error.message);
  if (linkResult.error) throw new Error(linkResult.error.message);
  if (sceneResult.error) throw new Error(sceneResult.error.message);

  const graph = await loadTrackCreativeIntelligenceGraph(
    db as unknown as SupabaseClient,
    project.track_id,
    ownerId,
    lyrics,
  );

  const assetIds = [...new Set([
    ...(linkResult.data ?? []).map((link) => link.media_asset_id),
    ...creativeMemory.recommendations.map((recommendation) => recommendation.assetId),
  ])];
  const { data: media, error: mediaError } = assetIds.length
    ? await db.from("media_assets")
        .select("id,asset_type,mime_type,metadata,public_url")
        .eq("owner_id", ownerId)
        .in("id", assetIds)
    : { data: [], error: null };
  if (mediaError) throw new Error(mediaError.message);

  const recommendationByAsset = new Map(
    creativeMemory.recommendations.map((recommendation) => [recommendation.assetId, recommendation]),
  );
  const enrichedMedia = (media ?? []).map((asset) => {
    const recommendation = recommendationByAsset.get(asset.id);
    if (!recommendation) return asset;
    return {
      ...asset,
      metadata: {
        ...jsonRecord(asset.metadata),
        creative_memory: {
          recommendation_score: recommendation.score,
          reasons: recommendation.reasons,
          approvals: recommendation.approvals,
          rejections: recommendation.rejections,
          uses: recommendation.uses,
          performance_score: recommendation.performanceScore,
          brand_relevance: recommendation.brandRelevance,
          visual_descriptors: recommendation.visualDescriptors,
          semantic_descriptors: recommendation.semanticDescriptors,
        },
      } satisfies Json,
    };
  });

  const preferences: DirectorPreferences = {
    positive: creativeMemory.preferences.positive,
    negative: creativeMemory.preferences.negative,
  };

  return {
    artistId,
    project,
    release: releaseResult.data,
    track: trackResult.data,
    musicMap: stemAwareMusicMap(project.music_map, (sceneResult.data ?? []) as AudioScene[], graph),
    lyrics,
    brandSettings: (brandResult.data ?? []).map((item) => item.content),
    media: enrichedMedia,
    preferences,
    creativeMemory: {
      summary: creativeMemory.preferences.summary,
      evidenceCount: creativeMemory.eventCount,
      recommendations: creativeMemory.recommendations,
    },
  };
}

export async function resolveProjectAudioUrl(
  db: SupabaseClient<VideoDatabase>,
  project: ExtendedMusicVideoProject,
  ownerId: string,
  artistId?: string | null,
) {
  const musicDb = db as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
  let trackQuery = musicDb.from("tracks")
    .select("audio_url")
    .eq("id", project.track_id)
    .eq("owner_id", ownerId);
  if (artistId) trackQuery = trackQuery.eq("artist_id", artistId);
  const { data: track, error } = await trackQuery.single();
  if (error) throw new Error(error.message);
  if (track?.audio_url) return track.audio_url;

  let linkQuery = musicDb.from("media_links")
    .select("media_asset_id,role,is_primary")
    .eq("owner_id", ownerId)
    .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`)
    .in("role", ["master_audio", "audio_preview"]);
  if (artistId) linkQuery = linkQuery.eq("artist_id", artistId);
  const { data: links, error: linkError } = await linkQuery.order("is_primary", { ascending: false });
  if (linkError) throw new Error(linkError.message);
  const ids = (links ?? []).map((link) => link.media_asset_id);
  if (!ids.length) return null;
  const { data: assets, error: assetError } = await db.from("media_assets")
    .select("id,public_url")
    .eq("owner_id", ownerId)
    .in("id", ids);
  if (assetError) throw new Error(assetError.message);
  const ordered = ids.map((id) => (assets ?? []).find((asset) => asset.id === id));
  return ordered.find((asset) => asset?.public_url)?.public_url ?? null;
}
