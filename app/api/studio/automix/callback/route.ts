import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { AutoMixJob } from "@/types/automix-database";
import type { Json } from "@/types/database";

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

function terminalRequestPayload(value: Record<string, unknown>) {
  const next = { ...value };
  // Keep the one-way callback verifier internally so duplicate/late worker callbacks can
  // still authenticate and be acknowledged. Artist-facing GET responses always strip it.
  delete next.upload_url;
  delete next.tracks;
  return next;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

async function canonicalMastersStillMatch(job: AutoMixJob) {
  const service = createServiceClient();
  const musicDb = asArtistScopedMusicClient(service);
  const tracks = await musicDb.from("tracks")
    .select("id,audio_url")
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .in("id", job.track_ids);
  if (tracks.error) throw new Error(tracks.error.message);
  const current = new Map((tracks.data ?? []).map((track) => [track.id, track.audio_url]));
  const fingerprints = Array.isArray(job.source_fingerprints) ? job.source_fingerprints : [];
  if (current.size !== job.track_ids.length || fingerprints.length !== job.track_ids.length) return false;

  const expectedTrackIds = new Set(job.track_ids);
  const seenTrackIds = new Set<string>();
  const allMatch = fingerprints.every((value) => {
    const item = record(value);
    const trackId = typeof item.track_id === "string" ? item.track_id : "";
    const audioUrl = typeof item.audio_url === "string" ? item.audio_url : "";
    if (!trackId || !audioUrl || !expectedTrackIds.has(trackId) || seenTrackIds.has(trackId)) return false;
    seenTrackIds.add(trackId);
    return current.get(trackId) === audioUrl;
  });
  return allMatch && seenTrackIds.size === expectedTrackIds.size;
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
  const db = asAutoMixClient(service);
  const jobs = await db.from("automix_jobs").select("*").eq("id", jobId).single();
  if (jobs.error || !jobs.data) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const job = jobs.data as AutoMixJob;
  const requestPayload = record(job.request_payload);
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (["completed", "failed", "cancelled"].includes(job.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const previousResult = record(job.result_payload);
    const mergedResult = Object.keys(result).length ? { ...previousResult, ...result } : previousResult;
    const update = await db.from("automix_jobs").update({
      status: "running",
      result_payload: json(mergedResult),
      started_at: job.started_at || new Date().toISOString(),
      error: null,
    }).eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    if (!update.data) {
      scheduleCleanup();
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = callbackError || "AutoMix worker job failed.";
    const update = await db.from("automix_jobs").update({
      status: "failed",
      request_payload: json(terminalRequestPayload(requestPayload)),
      result_payload: json(result),
      error: message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 500 });
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: !update.data });
  }

  try {
    if (!(await canonicalMastersStillMatch(job))) {
      const message = "A canonical track master changed while this mix was rendering. The late mix was kept out of the active catalog.";
      const staleUpdate = await db.from("automix_jobs").update({
        status: "cancelled",
        request_payload: json(terminalRequestPayload(requestPayload)),
        result_payload: json(result),
        error: message,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id)
        .eq("owner_id", job.owner_id)
        .in("status", ["queued", "running"])
        .select("id")
        .maybeSingle();
      if (staleUpdate.error) throw new Error(staleUpdate.error.message);
      scheduleCleanup();
      return NextResponse.json({ ok: true, stale: Boolean(staleUpdate.data), duplicate: !staleUpdate.data });
    }

    const path = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : job.output_path;
    const bucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : job.output_bucket;
    const publicUrl = typeof requestPayload.public_url === "string" ? requestPayload.public_url : "";
    if (!path || !bucket || !publicUrl) throw new Error("AutoMix callback is missing output lineage.");
    const mimeType = typeof result.mime_type === "string"
      ? result.mime_type
      : job.output_format === "wav" ? "audio/wav" : "audio/mpeg";
    const render = record(result.render);

    const latestBeforeCatalog = await db.from("automix_jobs")
      .select("status")
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .maybeSingle();
    if (latestBeforeCatalog.error) throw new Error(latestBeforeCatalog.error.message);
    if (!latestBeforeCatalog.data || !["queued", "running"].includes(latestBeforeCatalog.data.status)) {
      scheduleCleanup();
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const existing = await service.from("media_assets")
      .select("*")
      .eq("owner_id", job.owner_id)
      .contains("metadata", { automix_job_id: job.id })
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
        asset_type: "audio_master",
        mime_type: mimeType,
        file_size: typeof result.file_size === "number" ? result.file_size : null,
        content_hash: typeof result.sha256 === "string" ? result.sha256 : null,
        width: null,
        height: null,
        duration_ms: typeof render.duration_ms === "number" ? render.duration_ms : null,
        visibility: "public",
        metadata: json({
          original_name: `ensemblis-automix-${job.id}.${job.output_format}`,
          title: job.name,
          description: "Professional catalog mix rendered by Ensemblis AutoMix.",
          tags: ["automix", job.purpose, "dj-mix"],
          upload_source: "atlas_media_worker",
          source_kind: "automix",
          automix_job_id: job.id,
          artist_id: job.artist_id,
          track_ids: job.track_ids,
          source_fingerprints: job.source_fingerprints,
          engine: result.engine ?? null,
          quality_contract: record(result.plan).quality_contract ?? null,
        }),
      }).select("*").single();
      if (created.error || !created.data) throw new Error(created.error?.message || "Could not register AutoMix output.");
      asset = created.data;
    }

    const update = await db.from("automix_jobs").update({
      status: "completed",
      request_payload: json(terminalRequestPayload(requestPayload)),
      result_payload: json(result),
      output_asset_id: asset.id,
      error: null,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (update.error) throw new Error(update.error.message);

    if (!update.data) {
      const latest = await db.from("automix_jobs")
        .select("status,output_asset_id")
        .eq("id", job.id)
        .eq("owner_id", job.owner_id)
        .maybeSingle();
      if (latest.error) throw new Error(latest.error.message);
      if (latest.data?.status === "cancelled" && latest.data.output_asset_id !== asset.id) {
        await service.from("media_assets").delete().eq("id", asset.id).eq("owner_id", job.owner_id);
        await service.storage.from(bucket).remove([path]);
      }
      scheduleCleanup();
      return NextResponse.json({ ok: true, duplicate: true, cancelled: latest.data?.status === "cancelled" });
    }

    scheduleCleanup();
    return NextResponse.json({ ok: true, mediaAssetId: asset.id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AutoMix callback failed" }, { status: 500 });
  }
}
