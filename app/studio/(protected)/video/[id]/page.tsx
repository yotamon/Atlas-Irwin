import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createServiceClient } from "@/lib/supabase/service";
import { openAIDirectorReadiness } from "@/lib/video-director/openai-director";
import { mediaWorkerReadiness } from "@/lib/video-director/worker";
import { resolveProjectAudioUrl } from "@/lib/video-director/context";
import { higgsfieldReadiness } from "@/lib/video-providers/higgsfield/client";
import { VideoProjectWorkspace } from "@/components/studio/video-director/project-workspace";
import type { Json, MediaAsset } from "@/types/database";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await requireStudioAdmin();
  const db = createServiceClient();

  const { data: project, error: projectError } = await db.from("music_video_projects")
    .select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (projectError) throw new Error(projectError.message);
  if (!project) notFound();

  const [
    releaseResult,
    trackResult,
    conceptsResult,
    scenesResult,
    shotsResult,
    generationsResult,
    approvalsResult,
    rendersResult,
    workerJobsResult,
    mediaLinksResult,
    thumbnailAssetsResult,
  ] = await Promise.all([
    db.from("releases").select("*").eq("id", project.release_id).eq("owner_id", user.id).maybeSingle(),
    db.from("tracks").select("*").eq("id", project.track_id).eq("owner_id", user.id).maybeSingle(),
    db.from("music_video_concepts").select("*").eq("project_id", project.id).eq("owner_id", user.id)
      .order("round_number", { ascending: false }).order("display_order"),
    db.from("music_video_scenes").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("display_order"),
    db.from("music_video_shots").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("display_order"),
    db.from("music_video_generations").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at"),
    db.from("music_video_approvals").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }),
    db.from("music_video_renders").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }),
    db.from("music_video_worker_jobs").select("*").eq("project_id", project.id).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(50),
    db.from("media_links").select("id,media_asset_id,role,release_id,track_id")
      .eq("owner_id", user.id).or(`release_id.eq.${project.release_id},track_id.eq.${project.track_id}`),
    db.from("media_assets").select("*")
      .eq("owner_id", user.id)
      .eq("asset_type", "thumbnail")
      .contains("metadata", { project_id: project.id })
      .order("created_at"),
  ]);

  const firstError = [
    releaseResult.error,
    trackResult.error,
    conceptsResult.error,
    scenesResult.error,
    shotsResult.error,
    generationsResult.error,
    approvalsResult.error,
    rendersResult.error,
    workerJobsResult.error,
    mediaLinksResult.error,
    thumbnailAssetsResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);
  const release = releaseResult.data;
  const track = trackResult.data;
  if (!release || !track || track.release_id !== release.id) notFound();

  const shots = shotsResult.data ?? [];
  const generations = generationsResult.data ?? [];
  const renders = rendersResult.data ?? [];
  const linkedAssetIds = (mediaLinksResult.data ?? []).map((link) => link.media_asset_id);
  const assetIds = [...new Set([
    ...linkedAssetIds,
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
  const audioUrl = hasAudio ? await resolveProjectAudioUrl(db, project, user.id) : null;

  return (
    <VideoProjectWorkspace
      data={{
        project,
        release,
        track,
        audioUrl,
        concepts: conceptsResult.data ?? [],
        scenes: scenesResult.data ?? [],
        shots,
        generations,
        approvals: approvalsResult.data ?? [],
        renders,
        workerJobs: workerJobsResult.data ?? [],
        assets,
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
