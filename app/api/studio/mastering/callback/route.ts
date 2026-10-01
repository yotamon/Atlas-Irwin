import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { TrackMasteringJob } from "@/types/mastering-database";

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
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request, requestPayload: Record<string, unknown>) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  const expectedHash = requestPayload[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actualHash = createHash("sha256").update(token).digest("hex");
  return safeEqual(actualHash, expectedHash);
}

function cleanRequestPayload(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  delete next.upload_url;
  delete next.chunk_uploads;
  return next;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

export async function POST(request: Request) {
  const payload = record(await request.json().catch(() => null));
  const jobId = typeof payload.job_id === "string" ? payload.job_id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const result = record(payload.result);
  const callbackError = typeof payload.error === "string" ? payload.error : null;
  if (!jobId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const service = createServiceClient();
  const db = asMasteringClient(service);
  const jobs = await db.from("track_mastering_jobs").select("*").eq("id", jobId).single();
  if (jobs.error || !jobs.data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const job = jobs.data as TrackMasteringJob;
  const requestPayload = record(job.request_payload);
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const update = await db.from("track_mastering_jobs").update({
      status: "running",
      started_at: job.started_at || new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("owner_id", job.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = callbackError || "Active Mastering worker job failed.";
    const update = await db.from("track_mastering_jobs").update({
      status: "failed",
      request_payload: json(cleanRequestPayload(requestPayload)),
      result_payload: json(result),
      error: message,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("owner_id", job.owner_id);
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ ok: true });
  }

  try {
    const growth = asGrowthClient(service);
    const current = await growth.from("track_vault")
      .select("audio_url")
      .eq("id", job.track_vault_id)
      .eq("owner_id", job.owner_id)
      .eq("artist_id", job.artist_id)
      .maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data || current.data.audio_url !== job.source_audio_url) {
      const message = "The canonical source master changed while this candidate was rendering. The late result was kept out of the active workflow.";
      await db.from("track_mastering_jobs").update({
        status: "cancelled",
        request_payload: json(cleanRequestPayload(requestPayload)),
        result_payload: json(result),
        error: message,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id).eq("owner_id", job.owner_id);
      scheduleCleanup();
      return NextResponse.json({ ok: true, stale: true });
    }

    const path = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : job.output_path;
    const bucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : job.output_bucket;
    const output = record(result.output);
    const storage = record(result.storage);
    const storageMode = typeof storage.storage_mode === "string" ? storage.storage_mode : "single_object";
    const directPublicUrl = typeof requestPayload.direct_public_url === "string"
      ? requestPayload.direct_public_url
      : typeof requestPayload.public_url === "string"
        ? requestPayload.public_url
        : "";
    const chunkedPublicUrl = typeof requestPayload.chunked_public_url === "string"
      ? requestPayload.chunked_public_url
      : "";
    const publicUrl = storageMode === "chunked_lossless" ? chunkedPublicUrl : directPublicUrl;
    const finalChecks = record(result.final_checks);
    const verifiedForDistribution = finalChecks.pass === true;
    if (!path || !bucket || !publicUrl) throw new Error("Active Mastering callback is missing output lineage.");
    const container = typeof output.container === "string" ? output.container.toUpperCase() : "";
    const isFlac = container === "FLAC" || path.toLowerCase().endsWith(".flac");
    const mimeType = isFlac ? "audio/flac" : "audio/wav";
    const extension = isFlac ? "flac" : "wav";
    const bitDepth = typeof output.bit_depth === "number" && Number.isFinite(output.bit_depth)
      ? Math.round(output.bit_depth)
      : null;
    const sampleRateHz = typeof output.sample_rate_hz === "number" && Number.isFinite(output.sample_rate_hz)
      ? Math.round(output.sample_rate_hz)
      : null;

    const existing = await service.from("media_assets")
      .select("*")
      .eq("owner_id", job.owner_id)
      .contains("metadata", { mastering_job_id: job.id })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    let asset = existing.data;
    if (!asset) {
      const created = await service.from("media_assets").insert({
        owner_id: job.owner_id,
        bucket_name: bucket,
        storage_path: path,
        public_url: publicUrl,
        asset_type: "master_audio",
        mime_type: mimeType,
        file_size: typeof output.file_size === "number" ? output.file_size : null,
        content_hash: typeof output.sha256 === "string" ? output.sha256 : null,
        width: null,
        height: null,
        duration_ms: null,
        visibility: "public",
        metadata: json({
          original_name: `ensemblis-${job.preset}-master-${job.id}.${extension}`,
          title: `Ensemblis ${job.preset} master`,
          description: `${bitDepth ? `${bitDepth}-bit ` : ""}${isFlac ? "lossless FLAC" : "WAV"} rendered by Ensemblis Active Mastering${sampleRateHz ? ` at ${Math.round(sampleRateHz / 100) / 10} kHz` : ""}.`,
          tags: ["active-mastering", job.preset, verifiedForDistribution ? "distribution-ready" : "review-required"],
          upload_source: "atlas_media_worker",
          source_kind: "active_mastering_candidate",
          mastering_job_id: job.id,
          track_vault_id: job.track_vault_id,
          artist_id: job.artist_id,
          source_master_url: job.source_audio_url,
          mastering_schema: result.schema ?? null,
          final_checks: finalChecks,
          storage_mode: storageMode,
          chunk_manifest: Array.isArray(storage.chunk_manifest) ? storage.chunk_manifest : [],
          canonical_file_size: typeof output.file_size === "number" ? output.file_size : null,
          canonical_sha256: typeof output.sha256 === "string" ? output.sha256 : null,
        }),
      }).select("*").single();
      if (created.error || !created.data) throw new Error(created.error?.message || "Could not register mastered output.");
      asset = created.data;
    }

    const cleanPayload = {
      ...cleanRequestPayload(requestPayload),
      public_url: publicUrl,
    };
    const update = await db.from("track_mastering_jobs").update({
      status: "completed",
      request_payload: json(cleanPayload),
      result_payload: json(result),
      output_asset_id: asset.id,
      error: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id).eq("owner_id", job.owner_id);
    if (update.error) throw new Error(update.error.message);
    scheduleCleanup();
    return NextResponse.json({ ok: true, mediaAssetId: asset.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Active Mastering callback failed";
    console.error("[mastering-callback] completion failed", { jobId: job.id, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
