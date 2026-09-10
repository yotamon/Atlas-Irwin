import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { createMarketingServiceClient } from "@/lib/marketing/db";
import { reviewGeneratedCreativeVideo } from "@/lib/marketing/creative-video-quality";
import { createServiceClient } from "@/lib/supabase/service";
import type { CreativeReferenceContext } from "@/lib/marketing/creative-context";
import type { CreativeTreatment } from "@/lib/marketing/creative-treatment";
import type { Json } from "@/types/database";
import type { MarketingMediaDatabase } from "@/types/marketing-media-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function marketing() {
  return createMarketingServiceClient() as unknown as SupabaseClient<MarketingMediaDatabase>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown) {
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
  if (!token || typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  return safeEqual(createHash("sha256").update(token).digest("hex"), expectedHash);
}

function cleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

function publicFrameUrls(requestPayload: Record<string, unknown>, result: Record<string, unknown>) {
  const requested = Array.isArray(requestPayload.review_frames) ? requestPayload.review_frames.map(record) : [];
  const allowed = new Map(requested
    .map((frame) => [typeof frame.public_url === "string" ? frame.public_url : "", Number(frame.timestamp_ms) || 0] as const)
    .filter(([url]) => /^https:\/\//i.test(url)));
  const returned = Array.isArray(result.review_frames) ? result.review_frames.map(record) : [];
  return returned
    .map((frame) => {
      const url = typeof frame.public_url === "string" ? frame.public_url : "";
      if (!allowed.has(url)) return null;
      return { url, timestampMs: Number(frame.timestamp_ms) || allowed.get(url) || 0 };
    })
    .filter((frame): frame is { url: string; timestampMs: number } => Boolean(frame));
}

async function registerFinishedAsset(input: {
  jobId: string;
  ownerId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  generationRunId: string | null;
  requestPayload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  const db = createServiceClient();
  const expectedUrl = typeof input.requestPayload.public_url === "string" ? input.requestPayload.public_url : "";
  const resultUrl = typeof input.result.public_url === "string" ? input.result.public_url : expectedUrl;
  if (!expectedUrl || resultUrl !== expectedUrl) throw new Error("Marketing worker returned an unexpected output URL.");
  const bucket = typeof input.requestPayload.upload_bucket === "string" ? input.requestPayload.upload_bucket : "public-media";
  const path = typeof input.requestPayload.upload_path === "string" ? input.requestPayload.upload_path : "";
  if (!path) throw new Error("Marketing worker output storage path is missing.");

  const { data: existing, error: existingError } = await db.from("media_assets")
    .select("*")
    .eq("owner_id", input.ownerId)
    .contains("metadata", { marketing_finishing_job_id: input.jobId })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  let asset = existing;
  if (!asset) {
    const { data, error } = await db.from("media_assets").insert({
      owner_id: input.ownerId,
      bucket_name: bucket,
      storage_path: path,
      public_url: expectedUrl,
      asset_type: "content_video",
      mime_type: typeof input.result.mime_type === "string" ? input.result.mime_type : "video/mp4",
      file_size: Number(input.result.file_size) || null,
      content_hash: typeof input.result.sha256 === "string" ? input.result.sha256 : null,
      width: Number(input.result.width) || null,
      height: Number(input.result.height) || null,
      duration_ms: Number(input.result.duration_ms) || null,
      visibility: "public",
      metadata: json({
        title: "Atlas finished social video",
        description: "Deterministically mastered by Atlas Media Worker after Creative Director generation.",
        tags: ["atlas-generated", "marketing", "finished", "temporal-qc"],
        upload_source: "atlas-media-worker",
        source_kind: "finished",
        marketing_finishing_job_id: input.jobId,
        marketing_generation_run_id: input.generationRunId,
        source_asset_id: typeof input.requestPayload.source_asset_id === "string" ? input.requestPayload.source_asset_id : null,
        campaign_id: input.campaignId,
        release_id: input.releaseId,
        content_item_id: input.contentItemId,
        platform_package_id: input.result.platform_package_id ?? input.requestPayload.platform_package_id ?? null,
        audio_source: input.result.audio_source ?? null,
        audio_scene_id: input.result.audio_scene_id ?? null,
        deterministic_overlay: input.result.deterministic_overlay === true,
      }),
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "Finished marketing video could not be registered.");
    asset = data;
  }
  if (!asset?.public_url) throw new Error("Finished marketing video is missing its public URL.");

  const { error: demoteError } = await db.from("media_links")
    .update({ is_primary: false })
    .eq("owner_id", input.ownerId)
    .eq("content_item_id", input.contentItemId)
    .eq("role", "content_video");
  if (demoteError) throw new Error(demoteError.message);
  const { data: link } = await db.from("media_links")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("content_item_id", input.contentItemId)
    .eq("media_asset_id", asset.id)
    .eq("role", "content_video")
    .limit(1)
    .maybeSingle();
  const linkRow = {
    owner_id: input.ownerId,
    media_asset_id: asset.id,
    release_id: input.releaseId,
    track_id: null,
    content_item_id: input.contentItemId,
    role: "content_video",
    display_order: 0,
    is_primary: true,
    caption: "Finished by Atlas Creative Engine",
    alt_text: null,
  };
  const linkMutation = link
    ? db.from("media_links").update(linkRow).eq("id", link.id)
    : db.from("media_links").insert(linkRow);
  const { error: linkError } = await linkMutation;
  if (linkError) throw new Error(linkError.message);
  return asset;
}

export async function POST(request: Request) {
  const body = record(await request.json().catch(() => ({})));
  const jobId = typeof body.job_id === "string" ? body.job_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  const result = record(body.result);
  const callbackError = typeof body.error === "string" ? body.error : null;
  if (!jobId || !["running", "completed", "failed"].includes(status)) {
    return NextResponse.json({ error: "Invalid callback" }, { status: 400 });
  }

  const db = marketing();
  const { data: job, error: jobError } = await db.from("marketing_media_jobs").select("*").eq("id", jobId).maybeSingle();
  if (jobError || !job) return NextResponse.json({ error: jobError?.message || "Job not found" }, { status: 404 });
  const requestPayload = record(job.request_payload);
  if (!authorized(request, requestPayload)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    cleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const { error } = await db.from("marketing_media_jobs").update({
      status: "running",
      started_at: job.started_at || new Date().toISOString(),
      error: null,
    }).eq("id", job.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    const message = callbackError || "Marketing Media Worker finishing failed.";
    const terminal = job.attempt_count >= job.max_attempts;
    const nextStatus = terminal ? "failed" : "planned";
    const { error } = await db.from("marketing_media_jobs").update({
      status: nextStatus,
      result_payload: json(result),
      external_job_id: null,
      error: message,
      started_at: null,
      completed_at: terminal ? new Date().toISOString() : null,
    }).eq("id", job.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (job.generation_run_id) {
      const { data: run } = await db.from("generation_runs").select("output").eq("id", job.generation_run_id).maybeSingle();
      const output = record(run?.output);
      await db.from("generation_runs").update({
        output: json({ ...output, stage: terminal ? "finishing_failed" : "finishing_retry_queued", finishingError: message }),
      }).eq("id", job.generation_run_id);
    }
    cleanup();
    return NextResponse.json({ ok: true, retrying: !terminal });
  }

  try {
    const asset = await registerFinishedAsset({
      jobId: job.id,
      ownerId: job.owner_id,
      campaignId: job.campaign_id,
      releaseId: job.release_id,
      contentItemId: job.content_item_id,
      generationRunId: job.generation_run_id,
      requestPayload,
      result,
    });
    if (!job.generation_run_id) throw new Error("Finished marketing media job has no generation lineage.");
    const { data: run, error: runError } = await db.from("generation_runs").select("*").eq("id", job.generation_run_id).single();
    if (runError || !run) throw new Error(runError?.message || "Generation lineage not found for finished video.");
    const inputContext = record(run.input_context);
    const treatment = inputContext.treatment;
    const referenceContext = inputContext.referenceContext;
    if (!treatment || typeof treatment !== "object" || Array.isArray(treatment)) throw new Error("Finished video has no Creative Treatment lineage.");
    if (!referenceContext || typeof referenceContext !== "object" || Array.isArray(referenceContext)) throw new Error("Finished video has no creative reference lineage.");
    const frames = publicFrameUrls(requestPayload, result);

    let visualQuality: Record<string, unknown>;
    try {
      const review = await reviewGeneratedCreativeVideo({
        ownerId: job.owner_id,
        parentGenerationRunId: job.generation_run_id,
        campaignId: job.campaign_id,
        releaseId: job.release_id,
        contentItemId: job.content_item_id,
        finishedAssetUrl: asset.public_url!,
        frames,
        treatment: treatment as unknown as CreativeTreatment,
        context: referenceContext as unknown as CreativeReferenceContext,
      });
      visualQuality = { status: "reviewed", ...review };
    } catch (error) {
      visualQuality = {
        status: "unavailable",
        passed: null,
        verdict: "manual_review",
        error: error instanceof Error ? error.message : "Temporal video quality review was unavailable.",
        humanReviewRequired: true,
      };
    }

    const qualityPassed = visualQuality.status === "reviewed" && visualQuality.passed === true;
    const qualityFailed = visualQuality.status === "reviewed" && visualQuality.passed === false;
    const runOutput = record(run.output);
    const stage = qualityPassed ? "creative_review" : qualityFailed ? "creative_qc_failed" : "creative_qc_pending";
    const { error: runUpdateError } = await db.from("generation_runs").update({
      output: json({
        ...runOutput,
        stage,
        resultUrl: asset.public_url,
        finishedMediaAssetId: asset.id,
        finishingJobId: job.id,
        finishingResult: result,
        visualQuality,
        approvalRequired: qualityPassed,
      }),
    }).eq("id", run.id);
    if (runUpdateError) throw new Error(runUpdateError.message);

    const { error: contentError } = await db.from("content_items").update({
      asset_url: asset.public_url,
      source: "ai",
      approval_status: qualityFailed ? "rejected" : "pending",
      generated_from_run_id: run.id,
    }).eq("id", job.content_item_id).eq("owner_id", job.owner_id);
    if (contentError) throw new Error(contentError.message);

    const { error: jobUpdateError } = await db.from("marketing_media_jobs").update({
      status: "completed",
      result_payload: json({ ...result, media_asset_id: asset.id, visualQuality }),
      error: null,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (jobUpdateError) throw new Error(jobUpdateError.message);

    const eventType = qualityPassed
      ? "content.ai_asset_ready_for_review"
      : qualityFailed
        ? "content.ai_asset_qc_failed"
        : "content.ai_asset_qc_pending";
    await db.from("marketing_events").insert({
      owner_id: job.owner_id,
      campaign_id: job.campaign_id,
      event_type: eventType,
      entity_type: "content_item",
      entity_id: job.content_item_id,
      payload: json({
        generationRunId: run.id,
        finishingJobId: job.id,
        mediaAssetId: asset.id,
        frameCount: frames.length,
        visualQuality,
      }),
    });
    cleanup();
    return NextResponse.json({ ok: true, qualityPassed, qualityFailed, mediaAssetId: asset.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketing media reconciliation failed.";
    await db.from("marketing_media_jobs").update({
      status: "failed",
      result_payload: json(result),
      error: message,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    cleanup();
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
