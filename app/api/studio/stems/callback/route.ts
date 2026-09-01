import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import {
  asStemClient,
  regenerateSystemAudioScenes,
} from "@/lib/music-intelligence/stem-scenes";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { AudioScene, TrackStem, TrackStemJob } from "@/types/stem-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function authorized(request: Request, requestPayload: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  if (!token) return false;
  const expectedHash = requestPayload[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actualHash = createHash("sha256").update(token).digest("hex");
  return safeEqual(actualHash, expectedHash);
}

function withoutCredential(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return next;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

async function currentTrackAudio(db: ReturnType<typeof asStemClient>, ownerId: string, trackId: string) {
  const result = await db.from("tracks")
    .select("audio_url")
    .eq("id", trackId)
    .eq("owner_id", ownerId)
    .single();
  if (result.error || !result.data) throw new Error(result.error?.message || "Track not found during Stem Intelligence reconciliation.");
  return result.data.audio_url;
}

async function markJobTerminal(
  db: ReturnType<typeof asStemClient>,
  job: TrackStemJob,
  status: "completed" | "failed" | "cancelled",
  result: Record<string, unknown>,
  error: string | null,
) {
  const update = await db.from("track_stem_jobs").update({
    status,
    request_payload: json(withoutCredential(record(job.request_payload))),
    result_payload: json(result),
    error,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id).eq("owner_id", job.owner_id);
  if (update.error) throw new Error(update.error.message);
}

async function failTarget(db: ReturnType<typeof asStemClient>, job: TrackStemJob, message: string) {
  if (job.job_type === "analyze_stem" && job.stem_id) {
    const update = await db.from("track_stems").update({ status: "failed", error: message }).eq("id", job.stem_id).eq("owner_id", job.owner_id);
    if (update.error) throw new Error(update.error.message);
  }
  if (job.job_type === "render_audio_scene" && job.scene_id) {
    const update = await db.from("audio_scenes").update({ status: "failed", preview_error: message }).eq("id", job.scene_id).eq("owner_id", job.owner_id);
    if (update.error) throw new Error(update.error.message);
  }
}

async function registerScenePreviewAsset(input: {
  db: ReturnType<typeof asStemClient>;
  job: TrackStemJob;
  scene: AudioScene;
  requestPayload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const path = typeof input.requestPayload.upload_path === "string" ? input.requestPayload.upload_path : "";
  const bucket = typeof input.requestPayload.upload_bucket === "string" ? input.requestPayload.upload_bucket : "public-media";
  const publicUrl = typeof input.requestPayload.public_url === "string" ? input.requestPayload.public_url : "";
  if (!path || !publicUrl) throw new Error("Audio Scene callback is missing storage lineage metadata.");

  const existing = await input.db.from("media_assets")
    .select("*")
    .eq("owner_id", input.job.owner_id)
    .contains("metadata", { stem_job_id: input.job.id })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data;
  const number = (key: string) => typeof input.result[key] === "number" ? input.result[key] as number : null;
  const created = await input.db.from("media_assets").insert({
    owner_id: input.job.owner_id,
    bucket_name: bucket,
    storage_path: path,
    public_url: publicUrl,
    asset_type: "audio_preview",
    mime_type: "audio/mpeg",
    file_size: number("file_size"),
    content_hash: null,
    width: null,
    height: null,
    duration_ms: number("duration_ms"),
    visibility: "public",
    metadata: json({
      original_name: `${input.scene.scene_type}-${input.scene.id}.mp3`,
      title: `${input.scene.name} preview`,
      description: "Rendered from Atlas Stem Intelligence Audio Scene recipe.",
      tags: ["stem-intelligence", "audio-scene", input.scene.scene_type],
      upload_source: "atlas_media_worker",
      source_kind: "audio_scene_render",
      track_id: input.scene.track_id,
      audio_scene_id: input.scene.id,
      stem_job_id: input.job.id,
      source_master_url: input.requestPayload.source_master_url ?? null,
      stem_set_fingerprint: input.requestPayload.stem_set_fingerprint ?? null,
      layer_count: number("layer_count"),
      gain_reduction_db: number("gain_reduction_db"),
    }),
  }).select("*").single();
  if (created.error || !created.data) throw new Error(created.error?.message || "Could not register the rendered Audio Scene preview.");
  return created.data;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as unknown;
  const payload = record(body);
  const jobId = typeof payload.job_id === "string" ? payload.job_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const result = record(payload.result);
  const callbackError = typeof payload.error === "string" ? payload.error : null;
  if (!jobId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const db = asStemClient(createServiceClient());
  const jobResult = await db.from("track_stem_jobs").select("*").eq("id", jobId).single();
  if (jobResult.error || !jobResult.data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const job = jobResult.data as TrackStemJob;
  const requestPayload = record(job.request_payload);
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const update = await db.from("track_stem_jobs").update({
      status: "running",
      started_at: job.started_at || new Date().toISOString(),
      error: null,
    }).eq("id", job.id).eq("owner_id", job.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    if (job.job_type === "analyze_stem" && job.stem_id) {
      await db.from("track_stems").update({ status: "analyzing", error: null }).eq("id", job.stem_id).eq("owner_id", job.owner_id);
    }
    if (job.job_type === "render_audio_scene" && job.scene_id) {
      await db.from("audio_scenes").update({ status: "rendering", preview_error: null }).eq("id", job.scene_id).eq("owner_id", job.owner_id);
    }
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = callbackError || "Stem Intelligence worker job failed.";
    try {
      await failTarget(db, job, message);
      await markJobTerminal(db, job, "failed", result, message);
      scheduleCleanup();
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Stem failure reconciliation failed" }, { status: 500 });
    }
  }

  try {
    const trackAudioUrl = await currentTrackAudio(db, job.owner_id, job.track_id);
    const expectedMasterUrl = typeof requestPayload.source_master_url === "string" ? requestPayload.source_master_url : "";
    if (!trackAudioUrl || !expectedMasterUrl || trackAudioUrl !== expectedMasterUrl) {
      const message = "Stem Intelligence result belongs to a previous canonical master and was discarded.";
      if (job.job_type === "analyze_stem" && job.stem_id) {
        await db.from("track_stems").update({ status: "stale", error: message }).eq("id", job.stem_id).eq("owner_id", job.owner_id);
      }
      if (job.job_type === "render_audio_scene" && job.scene_id) {
        await db.from("audio_scenes").update({ status: "stale", preview_error: message }).eq("id", job.scene_id).eq("owner_id", job.owner_id);
      }
      await markJobTerminal(db, job, "cancelled", result, message);
      scheduleCleanup();
      return NextResponse.json({ ok: true, stale: true, reason: "source_master_mismatch" });
    }

    if (job.job_type === "analyze_stem") {
      if (!job.stem_id) return NextResponse.json({ error: "Stem analysis job has no stem_id" }, { status: 422 });
      const stemResult = await db.from("track_stems").select("*").eq("id", job.stem_id).eq("owner_id", job.owner_id).single();
      if (stemResult.error || !stemResult.data) return NextResponse.json({ error: "Stem not found" }, { status: 404 });
      const stem = stemResult.data as TrackStem;
      if (stem.source_master_url !== trackAudioUrl) {
        const message = "Stem was rebound while its previous analysis was running. The late result was discarded.";
        await db.from("track_stems").update({ status: "stale", error: message }).eq("id", stem.id).eq("owner_id", job.owner_id);
        await markJobTerminal(db, job, "cancelled", result, message);
        scheduleCleanup();
        return NextResponse.json({ ok: true, stale: true, reason: "stem_binding_mismatch" });
      }
      const analysis = record(result.stem_analysis);
      if (!Object.keys(analysis).length) return NextResponse.json({ error: "Worker returned no stem analysis" }, { status: 422 });
      const alignment = record(analysis.alignment);
      const update = await db.from("track_stems").update({
        status: "ready",
        source_stem_sha256: typeof result.source_stem_sha256 === "string" ? result.source_stem_sha256 : null,
        analysis_pcm_sha256: typeof result.analysis_pcm_sha256 === "string" ? result.analysis_pcm_sha256 : null,
        duration_ms: typeof result.duration_ms === "number" ? Math.round(result.duration_ms) : null,
        sample_rate: typeof result.sample_rate === "number" ? Math.round(result.sample_rate) : null,
        channels: typeof result.channels === "number" ? Math.round(result.channels) : null,
        offset_ms: typeof result.offset_ms === "number" ? Math.round(result.offset_ms) : 0,
        alignment_confidence: typeof result.alignment_confidence === "number" ? Math.max(0, Math.min(1, result.alignment_confidence)) : 0,
        analysis_version: typeof analysis.version === "number" ? Math.max(1, Math.round(analysis.version)) : 1,
        analysis: json(analysis),
        alignment: json(alignment),
        error: null,
        analyzed_at: new Date().toISOString(),
      }).eq("id", stem.id).eq("owner_id", job.owner_id);
      if (update.error) throw new Error(update.error.message);

      let sceneWarning: string | null = null;
      try {
        await regenerateSystemAudioScenes({ client: db, ownerId: job.owner_id, trackId: job.track_id });
      } catch (error) {
        sceneWarning = error instanceof Error ? error.message : "Smart Audio Scene regeneration failed.";
      }
      await markJobTerminal(db, job, "completed", sceneWarning ? { ...result, scene_warning: sceneWarning } : result, null);
      scheduleCleanup();
      return NextResponse.json({ ok: true, sceneWarning });
    }

    if (job.job_type === "render_audio_scene") {
      if (!job.scene_id) return NextResponse.json({ error: "Audio Scene render job has no scene_id" }, { status: 422 });
      const sceneResult = await db.from("audio_scenes").select("*").eq("id", job.scene_id).eq("owner_id", job.owner_id).single();
      if (sceneResult.error || !sceneResult.data) return NextResponse.json({ error: "Audio Scene not found" }, { status: 404 });
      const scene = sceneResult.data as AudioScene;
      const expectedFingerprint = typeof requestPayload.stem_set_fingerprint === "string" ? requestPayload.stem_set_fingerprint : null;
      if (scene.source === "system" && expectedFingerprint && scene.stem_set_fingerprint !== expectedFingerprint) {
        const message = "Stem set changed while the Audio Scene preview was rendering. The late preview was discarded.";
        await db.from("audio_scenes").update({ status: "ready", preview_error: message }).eq("id", scene.id).eq("owner_id", job.owner_id);
        await markJobTerminal(db, job, "cancelled", result, message);
        scheduleCleanup();
        return NextResponse.json({ ok: true, stale: true, reason: "stem_set_mismatch" });
      }
      const asset = await registerScenePreviewAsset({ db, job, scene, requestPayload, result });
      const sceneUpdate = await db.from("audio_scenes").update({
        status: "ready",
        preview_asset_id: asset.id,
        preview_error: null,
      }).eq("id", scene.id).eq("owner_id", job.owner_id);
      if (sceneUpdate.error) throw new Error(sceneUpdate.error.message);
      await markJobTerminal(db, job, "completed", { ...result, media_asset_id: asset.id }, null);
      scheduleCleanup();
      return NextResponse.json({ ok: true, mediaAssetId: asset.id });
    }

    return NextResponse.json({ error: "Unsupported Stem Intelligence job type" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Stem Intelligence callback reconciliation failed" }, { status: 500 });
  }
}
