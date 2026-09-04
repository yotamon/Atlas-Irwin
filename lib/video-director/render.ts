import "server-only";

import type { Json } from "@/types/database";
import type { Moment, MomentsDatabase } from "@/types/moments-database";
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

function clamp01(value: number | null | undefined) {
  return Math.max(0, Math.min(1, Number(value ?? 0)));
}

// `master_16_9` is retained as the persisted legacy render-type key. The actual master
// dimensions now follow project.primary_aspect_ratio so existing rows/migrations stay compatible.
export type VideoRenderType = "master_16_9" | "social_9_16" | "promo_30" | "hook_15";
export const QUICK_VIDEO_DERIVED_RENDER_TYPES = ["social_9_16", "promo_30", "hook_15"] as const satisfies readonly VideoRenderType[];

function primaryMasterDimensions(project: ExtendedMusicVideoProject) {
  switch (project.primary_aspect_ratio) {
    case "9:16": return { width: 1080, height: 1920 };
    case "1:1": return { width: 1080, height: 1080 };
    default: return { width: 1920, height: 1080 };
  }
}

function outputSpec(type: VideoRenderType, project: ExtendedMusicVideoProject) {
  switch (type) {
    case "social_9_16": return { width: 1080, height: 1920, durationMs: null, workerType: "render_social" as const };
    case "promo_30": return { ...primaryMasterDimensions(project), durationMs: 30000, workerType: "render_promo" as const };
    case "hook_15": return { width: 1080, height: 1920, durationMs: 15000, workerType: "render_hook" as const };
    default: return { ...primaryMasterDimensions(project), durationMs: null, workerType: "render_master" as const };
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

function momentScore(moment: Moment) {
  const tags = new Set(moment.purpose_tags ?? []);
  const purposeBoost = tags.has("hook") || tags.has("social") || tags.has("short_form") ? 0.07 : 0;
  return clamp01(
    clamp01(moment.confidence) * 0.32
    + clamp01(moment.hook_score) * 0.24
    + clamp01(moment.energy_score) * 0.12
    + clamp01(moment.emotional_score) * 0.10
    + clamp01(moment.vocal_score) * 0.08
    + clamp01(moment.uniqueness_score) * 0.14
    + purposeBoost,
  );
}

function overlapRatio(a: Moment, b: Moment) {
  const overlap = Math.max(0, Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms));
  return overlap / Math.max(1, Math.min(a.end_ms - a.start_ms, b.end_ms - b.start_ms));
}

async function approvedMoments(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  project: ExtendedMusicVideoProject,
) {
  const { data: release } = await db.from("releases")
    .select("artist_id")
    .eq("id", project.release_id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!release?.artist_id) return [];

  const momentsDb = db as unknown as SupabaseClient<MomentsDatabase>;
  const { data, error } = await momentsDb.from("moments")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", release.artist_id)
    .eq("release_id", project.release_id)
    .eq("track_id", project.track_id)
    .eq("state", "approved")
    .order("confidence", { ascending: false })
    .order("start_ms", { ascending: true })
    .limit(12);
  if (error) return [];
  return (data ?? [])
    .filter((moment) => moment.end_ms > moment.start_ms)
    .sort((a, b) => momentScore(b) - momentScore(a) || a.start_ms - b.start_ms || a.id.localeCompare(b.id));
}

function fitMomentWindow(moment: Moment, durationMs: number) {
  const available = moment.end_ms - moment.start_ms;
  if (available <= durationMs) return { start: moment.start_ms, end: moment.end_ms };
  const center = Math.round((moment.start_ms + moment.end_ms) / 2);
  const start = Math.max(moment.start_ms, Math.min(moment.end_ms - durationMs, center - Math.round(durationMs / 2)));
  return { start, end: start + durationMs };
}

function approvedMomentHighlight(
  moments: Moment[],
  durationMs: number,
  type: VideoRenderType,
) {
  if (!moments.length || !["hook_15", "promo_30"].includes(type)) return null;
  const strongest = moments[0];
  const selected = type === "promo_30"
    ? moments.find((moment, index) => index > 0 && overlapRatio(moment, strongest) < 0.45) ?? moments[1] ?? strongest
    : strongest;
  const fitted = fitMomentWindow(selected, durationMs);
  return {
    ...fitted,
    source: "approved_moment" as const,
    candidateId: null,
    momentId: selected.id,
    momentLabel: selected.label,
  };
}

function chooseHighlightWindow(
  project: ExtendedMusicVideoProject,
  durationMs: number,
) {
  const map = parseMusicMap(project.music_map);
  const trackDuration = map?.duration_ms || 0;
  const durationKey = String(Math.round(durationMs / 1000));
  const scoredCut = map?.social_cuts?.[durationKey];
  if (scoredCut && scoredCut.end_ms > scoredCut.start_ms) {
    return {
      start: Math.max(0, scoredCut.start_ms),
      end: Math.min(trackDuration || scoredCut.end_ms, scoredCut.end_ms),
      source: "music_intelligence" as const,
      candidateId: scoredCut.candidate_id,
      momentId: null,
      momentLabel: null,
    };
  }

  const candidate = [...(map?.hook_candidates ?? [])]
    .sort((a, b) => {
      const durationPenaltyA = Math.abs(a.duration_ms - durationMs) / Math.max(durationMs, 1);
      const durationPenaltyB = Math.abs(b.duration_ms - durationMs) / Math.max(durationMs, 1);
      return (durationPenaltyA - durationPenaltyB) || (b.score - a.score);
    })[0];
  if (candidate) {
    return {
      start: candidate.start_ms,
      end: candidate.end_ms,
      source: "hook_candidate" as const,
      candidateId: candidate.id,
      momentId: null,
      momentLabel: null,
    };
  }

  // Legacy/fallback compatibility only. v2 maps should resolve above.
  const sections = map?.sections ?? [];
  const strongest = [...sections].sort((a, b) => b.energy - a.energy)[0];
  const center = strongest
    ? Math.round((strongest.start_ms + strongest.end_ms) / 2)
    : map?.peaks_ms?.[0] ?? Math.round(trackDuration / 2);
  const start = Math.max(0, Math.min(Math.max(0, trackDuration - durationMs), center - Math.round(durationMs / 2)));
  return {
    start,
    end: start + durationMs,
    source: "legacy_energy" as const,
    candidateId: null,
    momentId: null,
    momentLabel: null,
  };
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
  const spec = outputSpec(input.type, input.project);
  const outputIsVertical = spec.height > spec.width;
  const sourceIsAlreadyVertical = input.project.primary_aspect_ratio === "9:16";
  const requiresVerticalReframe = outputIsVertical && !sourceIsAlreadyVertical;
  const unsafeShotIds = requiresVerticalReframe
    ? sources.filter(({ shot }) => !isVerticalSafe(shot)).map(({ shot }) => shot.id)
    : [];
  if (unsafeShotIds.length && !input.allowUnsafeVertical) {
    throw new Error(`${unsafeShotIds.length} shot${unsafeShotIds.length === 1 ? " is" : "s are"} not marked vertical-safe. Review reframing or explicitly approve intelligent crop before rendering.`);
  }

  const fullStart = sources[0].shot.start_ms;
  const fullEnd = sources.at(-1)!.shot.end_ms;
  const moments = spec.durationMs ? await approvedMoments(input.db, input.ownerId, input.project) : [];
  const highlighted = spec.durationMs
    ? approvedMomentHighlight(moments, Math.min(spec.durationMs, fullEnd - fullStart), input.type)
      ?? chooseHighlightWindow(input.project, Math.min(spec.durationMs, fullEnd - fullStart))
    : null;
  const window = highlighted
    ? { start: Math.max(fullStart, highlighted.start), end: Math.min(fullEnd, highlighted.end) }
    : { start: fullStart, end: fullEnd };
  if (window.end <= window.start) throw new Error("Selected music-intelligence window does not overlap the locked storyboard timeline.");

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
      vertical_safe: sourceIsAlreadyVertical || isVerticalSafe(shot),
    }];
  });
  return {
    version: 3,
    type: input.type,
    primary_aspect_ratio: input.project.primary_aspect_ratio,
    width: spec.width,
    height: spec.height,
    fps: 30,
    audio_url: input.audioUrl,
    audio_start_ms: window.start,
    duration_ms: window.end - window.start,
    music_window_source: highlighted?.source ?? "full_timeline",
    music_moment_id: highlighted?.momentId ?? null,
    music_moment_label: highlighted?.momentLabel ?? null,
    music_hook_candidate_id: highlighted?.candidateId ?? null,
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
  const spec = outputSpec(input.type, input.project);
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
  const { error: renderQueueError } = await input.db.from("music_video_renders")
    .update({ status: "queued", worker_job_id: worker.id })
    .eq("id", render.id);
  if (renderQueueError) throw new Error(renderQueueError.message);
  const projectUpdate: Partial<ExtendedMusicVideoProject> = input.type === "master_16_9"
    ? { status: "rendering", render_manifest: json(manifest), last_error: null }
    : { render_manifest: json(manifest), last_error: null };
  const { error: projectError } = await input.db.from("music_video_projects")
    .update(projectUpdate)
    .eq("id", input.project.id)
    .eq("owner_id", input.ownerId);
  if (projectError) throw new Error(projectError.message);
  return { render, worker, manifest };
}

export async function queueVideoRenderIfMissing(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
  type: VideoRenderType;
  audioUrl: string;
  allowUnsafeVertical?: boolean;
}) {
  const { data: existing, error } = await input.db.from("music_video_renders")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("project_id", input.project.id)
    .eq("render_type", input.type)
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  if (existing?.[0]) {
    return {
      queued: false as const,
      render: existing[0],
      worker: null,
      manifest: existing[0].render_spec,
    };
  }
  const queued = await queueVideoRender(input);
  return { queued: true as const, ...queued };
}
