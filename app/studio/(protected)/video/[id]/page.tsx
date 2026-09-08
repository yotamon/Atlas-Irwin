import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadArtistCreativeMemory } from "@/lib/creative-memory/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { mediaWorkerReadiness } from "@/lib/video-director/worker";
import { resolveProjectAudioUrl } from "@/lib/video-director/context";
import { higgsfieldReadiness } from "@/lib/video-providers/higgsfield/client";
import { VideoProjectWorkspace } from "@/components/studio/video-director/project-workspace";
import type { Json, MediaAsset } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function hasStructuredValue(value: unknown) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}

function strings(value: Json) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueAssets(assets: MediaAsset[]) {
  return [...new Map(assets.map((asset) => [asset.id, asset])).values()];
}

export default async function VideoProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { id } = await params;
  const { mode } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = createServiceClient();
  const videoDb = db as unknown as SupabaseClient<VideoDatabase>;
  const music = asArtistScopedMusicClient(db);

  const { data: project, error: projectError } = await videoDb.from("music_video_projects")
    .select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) notFound();

  const [
    releaseResult,
    trackResult,
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
    music.from("releases").select("*")
      .eq("id", project.release_id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    music.from("tracks").select("*")
      .eq("id", project.track_id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    videoDb.from("music_video_concepts").select("*").eq("project_id", project.id).eq("owner_id", user.id)
      .order("round_number", { ascending: false }).order("display_order"),
    videoDb.from("music_video_scenes").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("display_order"),
    videoDb.from("music_video_shots").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("display_order"),
    videoDb.from("music_video_characters").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at"),
    videoDb.from("music_video_generations").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at"),
    videoDb.from("music_video_approvals").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }),
    videoDb.from("music_video_renders").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }),
    videoDb.from("music_video_worker_jobs").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50),
    music.from("media_links").select("id,media_asset_id,role,release_id,track_id,artist_id")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`),
    db.from("media_assets").select("*")
      .eq("owner_id", user.id)
      .eq("asset_type", "thumbnail")
      .contains("metadata", { project_id: project.id })
      .order("created_at"),
    db.from("track_lyrics").select("id,version,status")
      .eq("owner_id", user.id).eq("track_id", project.track_id).maybeSingle(),
    db.from("track_stems").select("id,category,label,status,duration_ms,analysis")
      .eq("owner_id", user.id).eq("track_id", project.track_id).order("display_order"),
    db.from("audio_scenes").select("id,name,scene_type,description,recommended_start_ms,recommended_end_ms,score")
      .eq("owner_id", user.id).eq("track_id", project.track_id).eq("status", "ready").order("score", { ascending: false }),
  ]);

  const firstError = [
    releaseResult.error,
    trackResult.error,
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
  const release = releaseResult.data;
  const track = trackResult.data;
  if (!release || !track || track.release_id !== release.id) notFound();

  const lyricLinesResult = lyricsResult.data && lyricsResult.data.status !== "instrumental"
    ? await db.from("track_lyric_lines").select("id,section_id,text,allow_media,start_ms,end_ms")
      .eq("owner_id", user.id)
      .eq("lyrics_id", lyricsResult.data.id)
      .eq("lyrics_version", lyricsResult.data.version)
      .order("display_order")
    : { data: [], error: null };
  if (lyricLinesResult.error) throw new Error(lyricLinesResult.error.message);
  const lyricCues = (lyricLinesResult.data ?? []).flatMap((line) =>
    line.start_ms !== null && line.end_ms !== null && line.end_ms > line.start_ms
      ? [{ id: line.id, text: line.text, startMs: line.start_ms, endMs: line.end_ms, sectionId: line.section_id, allowMedia: line.allow_media }]
      : [],
  );

  const creativeMemory = await loadArtistCreativeMemory({
    db,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: release.id,
    trackId: track.id,
    recommendationLimit: 8,
  });

  const shots = shotsResult.data ?? [];
  const characters = charactersResult.data ?? [];
  const generations = generationsResult.data ?? [];
  const renders = rendersResult.data ?? [];
  const linkedAssetIds = (mediaLinksResult.data ?? []).map((link) => link.media_asset_id);
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
  const { data: referencedAssets, error: assetsError } = assetIds.length
    ? await db.from("media_assets").select("*").eq("owner_id", user.id).in("id", assetIds)
    : { data: [] as MediaAsset[], error: null };
  if (assetsError) throw new Error(assetsError.message);
  const assets = uniqueAssets([...(referencedAssets ?? []), ...(thumbnailAssetsResult.data ?? [])]);

  const roles = new Set((mediaLinksResult.data ?? []).map((link) => link.role));
  const hasAudio = Boolean(track.audio_url) || roles.has("master_audio") || roles.has("audio_preview");
  const hasArtwork = Boolean(release.artwork_url) || roles.has("cover") || roles.has("alternate_artwork");
  const audioUrl = hasAudio ? await resolveProjectAudioUrl(db, project, user.id, artist.artistId) : null;

  return (
    <VideoProjectWorkspace
      mode={mode === "pro" ? "pro" : "default"}
      data={{
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
        creativeMemory: {
          summary: creativeMemory.preferences.summary,
          evidenceCount: creativeMemory.eventCount,
          recommendations: creativeMemory.recommendations,
        },
        services: {
          director: openAIDirectorReadiness(),
          higgsfield: higgsfieldReadiness(),
          worker: mediaWorkerReadiness(),
        },
        contextSignals: {
          hasAudio,
          hasArtwork,
          hasReleaseIdentity: hasStructuredValue(release.release_identity),
        },
      }}
    />
  );
}
