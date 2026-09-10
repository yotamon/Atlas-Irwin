import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { asAutoMixClient } from "@/lib/automix/jobs";
import {
  feedbackSignalFromEdit,
  feedbackSignalFromPlan,
  recordDjPreferenceEvidence,
} from "@/lib/automix/personalization";
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

const LEARNABLE_EDIT_OPERATIONS = new Set([
  "reorder_and_lock",
  "replace_track",
  "exclude_track",
  "override_transition",
  "reset_transition",
]);

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

function planLineage(value: Record<string, unknown>) {
  return record(value.plan_lineage);
}

function publicRenderLineage(result: Record<string, unknown>) {
  const manifest = record(result.render_manifest);
  const engine = record(result.engine);
  const render = record(result.render);
  const metrics = record(result.execution_metrics);
  const qa = record(result.qa_diagnostics);
  return {
    version: "ensemblis.automix-public-lineage.v1",
    plan_hash: typeof manifest.plan_hash === "string" ? manifest.plan_hash : null,
    mixplan_version: typeof manifest.version === "string" ? manifest.version : null,
    planner_version: typeof manifest.planner_version === "string" ? manifest.planner_version : null,
    render_engine_contract_version: typeof manifest.render_engine_contract_version === "string"
      ? manifest.render_engine_contract_version
      : null,
    renderer_version: typeof engine.renderer_version === "string" ? engine.renderer_version : null,
    rendered_duration_ms: typeof render.duration_ms === "number" ? render.duration_ms : null,
    source_track_count: typeof metrics.source_track_count === "number" ? metrics.source_track_count : null,
    transition_count: typeof qa.transition_count === "number" ? qa.transition_count : null,
  };
}

async function learnFromCompletedEdit(
  service: ReturnType<typeof createServiceClient>,
  job: AutoMixJob,
  requestPayload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const lineage = planLineage(requestPayload);
  const operation = typeof lineage.operation === "string" ? lineage.operation : "";
  if (!LEARNABLE_EDIT_OPERATIONS.has(operation)) return false;
  const plan = record(result.plan);
  if (!Object.keys(plan).length) return false;
  const { signal, weight } = feedbackSignalFromEdit(operation, plan);
  await recordDjPreferenceEvidence({
    client: service,
    ownerId: job.owner_id,
    artistId: job.artist_id,
    jobId: job.id,
    evidenceType: "plan_edit",
    evidenceKey: operation,
    signal,
    weight,
  });
  return true;
}

async function learnFromApprovedRender(
  service: ReturnType<typeof createServiceClient>,
  job: AutoMixJob,
  requestPayload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  if (requestPayload.execution_mode !== "approved_render") return false;
  const lineage = planLineage(requestPayload);
  if (lineage.operation !== "approve_render") return false;
  const plan = record(result.plan);
  if (!Object.keys(plan).length) return false;
  await recordDjPreferenceEvidence({
    client: service,
    ownerId: job.owner_id,
    artistId: job.artist_id,
    jobId: job.id,
    evidenceType: "plan_approval",
    evidenceKey: "approved_mixplan",
    signal: feedbackSignalFromPlan(plan),
    weight: 1,
  });
  return true;
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
  const executionMode = typeof requestPayload.execution_mode === "string" ? requestPayload.execution_mode : "render";
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The callback that won the terminal state transition owns Sandbox cleanup. A late duplicate
  // must never stop a shared named Sandbox after cleanup has already dispatched the next job.
  if (["completed", "failed", "cancelled"].includes(job.status)) {
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
    return NextResponse.json({ ok: true, duplicate: !update.data });
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
    if (update.data) scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: !update.data });
  }

  if (executionMode === "plan_only") {
    try {
      if (!(await canonicalMastersStillMatch(job))) {
        const message = "A canonical track master changed while this set was being planned. The stale plan was invalidated before it could be approved or rendered.";
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
        if (staleUpdate.data) scheduleCleanup();
        return NextResponse.json({ ok: true, stale: Boolean(staleUpdate.data), duplicate: !staleUpdate.data });
      }

      const update = await db.from("automix_jobs").update({
        status: "completed",
        request_payload: json(terminalRequestPayload(requestPayload)),
        result_payload: json(result),
        output_asset_id: null,
        error: null,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id)
        .eq("owner_id", job.owner_id)
        .in("status", ["queued", "running"])
        .select("id")
        .maybeSingle();
      if (update.error) throw new Error(update.error.message);
      let learningRecorded = false;
      if (update.data) {
        try {
          learningRecorded = await learnFromCompletedEdit(service, job, requestPayload, result);
        } catch {
          // A valid plan must stay valid even if optional preference aggregation is temporarily unavailable.
          learningRecorded = false;
        }
        scheduleCleanup();
      }
      return NextResponse.json({
        ok: true,
        planned: Boolean(update.data),
        duplicate: !update.data,
        learningRecorded,
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "AutoMix planning callback failed" }, { status: 500 });
    }
  }

  try {
    const path = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : job.output_path;
    const bucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : job.output_bucket;
    const publicUrl = typeof requestPayload.public_url === "string" ? requestPayload.public_url : "";
    if (!path || !bucket || !publicUrl) throw new Error("AutoMix callback is missing output lineage.");

    if (!(await canonicalMastersStillMatch(job))) {
      const message = "A canonical track master changed while this mix was rendering. The stale output was discarded before it could enter the catalog.";
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
      if (staleUpdate.data) {
        await service.storage.from(bucket).remove([path]).catch(() => undefined);
        scheduleCleanup();
      }
      return NextResponse.json({ ok: true, stale: Boolean(staleUpdate.data), duplicate: !staleUpdate.data });
    }

    const mimeType = typeof result.mime_type === "string"
      ? result.mime_type
      : job.output_format === "wav" ? "audio/wav" : "audio/mpeg";
    const render = record(result.render);
    const publicLineage = publicRenderLineage(result);

    const latestBeforeCatalog = await db.from("automix_jobs")
      .select("status")
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .maybeSingle();
    if (latestBeforeCatalog.error) throw new Error(latestBeforeCatalog.error.message);
    if (!latestBeforeCatalog.data || !["queued", "running"].includes(latestBeforeCatalog.data.status)) {
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
          public_render_lineage: publicLineage,
          approved_mixplan_hash: publicLineage.plan_hash,
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
      return NextResponse.json({ ok: true, duplicate: true, cancelled: latest.data?.status === "cancelled" });
    }

    let learningRecorded = false;
    try {
      learningRecorded = await learnFromApprovedRender(service, job, requestPayload, result);
    } catch {
      // Rendering/catalog integrity is authoritative. Preference learning is deliberately non-blocking.
      learningRecorded = false;
    }
    scheduleCleanup();
    return NextResponse.json({ ok: true, mediaAssetId: asset.id, learningRecorded });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "AutoMix callback failed" }, { status: 500 });
  }
}
