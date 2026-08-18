import "server-only";

import type { Json } from "@/types/database";
import type { ExtendedMusicVideoProject, ExtendedMusicVideoShot, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseMusicMap } from "./creative-director";
import { createWorkerRenderUploadTarget, queueMediaWorkerJob } from "./worker";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

export type VideoRenderType = "master_16_9" | "social_9_16" | "promo_30" | "hook_15";

function outputSpec(type: VideoRenderType) {
  switch (type) {
    case "social_9_16": return { width: 1080, height: 1920, durationMs: null, workerType: "render_social" as const };
    case "promo_30": return { width: 1920, height: 1080, durationMs: 30000, workerType: "render_promo" as const };
    case "hook_15": return { width: 1080, height: 1920, durationMs: 15000, workerType: "render_hook" as const };
    default: return { width: 1920, height: 1080, durationMs: null, workerType: "render_master" as const };
  }
}

function focusX(shot: ExtendedMusicVideoShot) {
  const value = record(shot.generation_params).vertical_focus;
  if (typeof value === "number") return Math.max(0, Math.min(1, value));
  if (value === "left") return 0.25;
  if (value === "right") return 0.75;
  return 0.5;
}

function isVerticalSafe(shot: ExtendedMusicVideoShot) {
  return record(shot.generation_params).vertical_safe === true;
}

function chooseHighlightWindow(project: ExtendedMusicVideoProject, durationMs: number) {
  const map = parseMusicMap(project.music_map);
  const trackDuration = map?.duration_ms || 0;
  const sections = map?.sections ?? [];
  const strongest = [...sections].sort((a, b) => b.energy - a.energy)[0];
  const center = strongest
    ? Math.round((strongest.start_ms + strongest.end_ms) / 2)
    : map?.peaks_ms?.[0] ?? Math.round(trackDuration / 2);
  const start = Math.max(0, Math.min(Math.max(0, trackDuration - durationMs), center - Math.round(durationMs / 2)));
  return { start, end: start + durationMs };
}

async function timelineSources(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  project: ExtendedMusicVideoProject,
) {
  const { data: shots, error } = await db.from("music_video_shots").select("*")
    .eq("owner_id", ownerId).eq("project_id", project.id).order("display_order");
  if (error) throw new Error(error.message);
  if (!shots?.length) throw new Error("Storyboard has no shots.");

  const directIds = [...new Set(shots.flatMap((shot) => shot.selected_asset_id ? [shot.selected_asset_id] : []))];
  const { data: assets, error: assetError } = directIds.length
    ? await db.from("media_assets").select("id,public_url").eq("owner_id", ownerId).in("id", directIds)
    : { data: [], error: null };
  if (assetError) throw new Error(assetError.message);
  const urls = new Map((assets ?? []).map((asset) => [asset.id, asset.public_url]));

  let previousAssetId: string | null = null;
  return shots.map((shot) => {
    let assetId = shot.selected_asset_id;
    if (!assetId && ["reuse_source", "reframe", "hold", "loop"].includes(shot.reuse_strategy)) assetId = previousAssetId;
    if (!assetId) throw new Error(`Shot ${shot.display_order + 1} has no locked source. Review or generate it before rendering.`);
    const url = urls.get(assetId);
    if (!url) throw new Error(`Shot ${shot.display_order + 1} source asset has no public URL.`);
    previousAssetId = assetId;
    return { shot, assetId, url };
  });
}

export async function buildRenderManifest(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
  type: VideoRenderType;
  audioUrl: string;
  allowUnsafeVertical?: boolean;
}) {
  const sources = await timelineSources(input.db, input.ownerId, input.project);
  const spec = outputSpec(input.type);
  const isVertical = spec.height > spec.width;
  const unsafeShotIds = isVertical
    ? sources.filter(({ shot }) => !isVerticalSafe(shot)).map(({ shot }) => shot.id)
    : [];
  if (unsafeShotIds.length && !input.allowUnsafeVertical) {
    throw new Error(`${unsafeShotIds.length} shot${unsafeShotIds.length === 1 ? " is" : "s are"} not marked vertical-safe. Review reframing or explicitly approve intelligent crop before rendering.`);
  }

  const fullStart = sources[0].shot.start_ms;
  const fullEnd = sources.at(-1)!.shot.end_ms;
  const window = spec.durationMs
    ? chooseHighlightWindow(input.project, Math.min(spec.durationMs, fullEnd - fullStart))
    : { start: fullStart, end: fullEnd };
  const clips = sources.flatMap(({ shot, url, assetId }) => {
    const overlapStart = Math.max(window.start, shot.start_ms);
    const overlapEnd = Math.min(window.end, shot.end_ms);
    if (overlapEnd <= overlapStart) return [];
    return [{
      shot_id: shot.id,
      asset_id: assetId,
      url,
      duration_ms: overlapEnd - overlapStart,
      source_offset_ms: Math.max(0, overlapStart - shot.start_ms),
      focus_x: focusX(shot),
      vertical_safe: isVerticalSafe(shot),
    }];
  });
  return {
    version: 1,
    type: input.type,
    width: spec.width,
    height: spec.height,
    fps: 30,
    audio_url: input.audioUrl,
    audio_start_ms: window.start,
    duration_ms: window.end - window.start,
    clips,
    unsafe_vertical_shot_ids: unsafeShotIds,
    generated_at: new Date().toISOString(),
  };
}

export async function queueVideoRender(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
  type: VideoRenderType;
  audioUrl: string;
  allowUnsafeVertical?: boolean;
}) {
  const manifest = await buildRenderManifest(input);
  const { data: render, error: renderError } = await input.db.from("music_video_renders").insert({
    owner_id: input.ownerId,
    project_id: input.project.id,
    render_type: input.type,
    render_spec: json(manifest),
    status: "planned",
    worker_job_id: null,
    media_asset_id: null,
    error: null,
  }).select("*").single();
  if (renderError || !render) throw new Error(renderError?.message || "Could not create render job.");
  const upload = await createWorkerRenderUploadTarget(input.db, input.ownerId, input.project.id, render.id);
  const spec = outputSpec(input.type);
  const workerPayload = {
    render_id: render.id,
    clips: manifest.clips,
    audio_url: manifest.audio_url,
    audio_start_ms: manifest.audio_start_ms,
    duration_ms: manifest.duration_ms,
    width: manifest.width,
    height: manifest.height,
    fps: manifest.fps,
    upload_url: upload.signedUrl,
    upload_bucket: upload.bucket,
    upload_path: upload.path,
    public_url: upload.publicUrl,
  };
  const worker = await queueMediaWorkerJob({
    db: input.db,
    project: input.project,
    ownerId: input.ownerId,
    jobType: spec.workerType,
    payload: workerPayload,
    idempotencyKey: `render:${render.id}`,
  });
  await input.db.from("music_video_renders").update({ status: "queued", worker_job_id: worker.id }).eq("id", render.id);
  const projectUpdate: Partial<ExtendedMusicVideoProject> = input.type === "master_16_9"
    ? { status: "rendering", render_manifest: json(manifest), last_error: null }
    : { render_manifest: json(manifest), last_error: null };
  await input.db.from("music_video_projects").update(projectUpdate).eq("id", input.project.id).eq("owner_id", input.ownerId);
  return { render, worker, manifest };
}
