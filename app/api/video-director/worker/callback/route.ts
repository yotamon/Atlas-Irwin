import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import {
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  scheduleMediaWorkerSandboxCleanup,
} from "@/lib/media-worker/sandbox";
import { createServiceClient } from "@/lib/supabase/service";
import {
  registerWorkerRenderAsset,
  registerWorkerThumbnailAsset,
} from "@/lib/video-director/assets";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function scheduleCleanup() {
  after(scheduleMediaWorkerSandboxCleanup());
}

async function markWorkerTerminal(
  db: ReturnType<typeof createServiceClient>,
  jobId: string,
  status: "completed" | "failed",
  result: Record<string, unknown>,
  error: string | null,
) {
  const { error: terminalError } = await db.from("music_video_worker_jobs").update({
    status,
    result_payload: json(result),
    error,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);
  if (terminalError) throw new Error(terminalError.message);
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

  const db = createServiceClient();
  const { data: job, error: jobError } = await db.from("music_video_worker_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (jobError || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const requestPayload = record(job.request_payload);
  if (!authorized(request, requestPayload)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (["completed", "failed"].includes(job.status)) {
    scheduleCleanup();
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    const { error } = await db.from("music_video_worker_jobs")
      .update({ status: "running", started_at: job.started_at || new Date().toISOString(), error: null })
      .eq("id", job.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    try {
      if (job.job_type === "analyze_audio") {
        const { error } = await db.from("music_video_projects").update({
          previous_status: "analyzing_audio",
          status: "blocked",
          last_error: callbackError || "Audio analysis failed",
        }).eq("id", job.project_id);
        if (error) throw new Error(error.message);
      } else if (job.job_type === "extract_frame") {
        const { error } = await db.from("music_video_projects")
          .update({ last_error: callbackError || "Thumbnail extraction failed" })
          .eq("id", job.project_id);
        if (error) throw new Error(error.message);
      } else {
        const renderId = typeof requestPayload.render_id === "string" ? requestPayload.render_id : null;
        if (!renderId) return NextResponse.json({ error: "Render job has no render_id" }, { status: 422 });
        const { data: render, error: renderLookupError } = await db.from("music_video_renders")
          .select("render_type")
          .eq("id", renderId)
          .eq("project_id", job.project_id)
          .maybeSingle();
        if (renderLookupError || !render) return NextResponse.json({ error: renderLookupError?.message || "Render not found" }, { status: 404 });
        const { error: renderUpdateError } = await db.from("music_video_renders")
          .update({ status: "failed", error: callbackError || "Render failed" })
          .eq("id", renderId);
        if (renderUpdateError) throw new Error(renderUpdateError.message);
        if (render.render_type === "master_16_9") {
          const { error } = await db.from("music_video_projects").update({
            previous_status: "rendering",
            status: "ready_to_render",
            last_error: callbackError || "Master render failed",
          }).eq("id", job.project_id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await db.from("music_video_projects")
            .update({ last_error: callbackError || "Derived render failed" })
            .eq("id", job.project_id);
          if (error) throw new Error(error.message);
        }
      }
      await markWorkerTerminal(db, job.id, "failed", result, callbackError || "Worker job failed");
      scheduleCleanup();
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Worker failure reconciliation failed" }, { status: 500 });
    }
  }

  if (job.job_type === "analyze_audio") {
    const musicMap = record(result.music_map);
    if (!Object.keys(musicMap).length) return NextResponse.json({ error: "Worker returned no music map" }, { status: 422 });
    try {
      const { error: projectError } = await db.from("music_video_projects").update({
        music_map: json(musicMap),
        status: "concept_review",
        previous_status: null,
        last_error: null,
        analysis_completed_at: new Date().toISOString(),
      }).eq("id", job.project_id);
      if (projectError) throw new Error(projectError.message);
      await markWorkerTerminal(db, job.id, "completed", result, null);
      scheduleCleanup();
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Audio analysis reconciliation failed" }, { status: 500 });
    }
  }

  if (job.job_type === "extract_frame") {
    const candidateId = typeof requestPayload.candidate_id === "string" ? requestPayload.candidate_id : "";
    const bucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : "public-media";
    const path = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : "";
    const publicUrl = typeof requestPayload.public_url === "string" ? requestPayload.public_url : "";
    const sourceAssetId = typeof requestPayload.source_asset_id === "string" ? requestPayload.source_asset_id : "";
    const timestampMs = typeof requestPayload.timestamp_ms === "number" ? requestPayload.timestamp_ms : NaN;
    if (!candidateId || !path || !publicUrl || !sourceAssetId || !Number.isFinite(timestampMs)) {
      return NextResponse.json({ error: "Thumbnail callback metadata missing" }, { status: 422 });
    }
    try {
      const asset = await registerWorkerThumbnailAsset({
        db,
        ownerId: job.owner_id,
        projectId: job.project_id,
        candidateId,
        bucket,
        path,
        publicUrl,
        timestampMs,
        sourceAssetId,
        result,
      });
      const { error: projectError } = await db.from("music_video_projects")
        .update({ last_error: null })
        .eq("id", job.project_id);
      if (projectError) throw new Error(projectError.message);
      await markWorkerTerminal(db, job.id, "completed", { ...result, media_asset_id: asset.id }, null);
      scheduleCleanup();
      return NextResponse.json({ ok: true });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Thumbnail reconciliation failed" }, { status: 500 });
    }
  }

  const renderId = typeof requestPayload.render_id === "string" ? requestPayload.render_id : "";
  if (!renderId) return NextResponse.json({ error: "Render job has no render_id" }, { status: 422 });
  const { data: render, error: renderError } = await db.from("music_video_renders")
    .select("*")
    .eq("id", renderId)
    .eq("project_id", job.project_id)
    .single();
  if (renderError || !render) return NextResponse.json({ error: "Render not found" }, { status: 404 });
  const bucket = typeof requestPayload.upload_bucket === "string" ? requestPayload.upload_bucket : "public-media";
  const path = typeof requestPayload.upload_path === "string" ? requestPayload.upload_path : "";
  const publicUrl = typeof requestPayload.public_url === "string" ? requestPayload.public_url : "";
  if (!path || !publicUrl) return NextResponse.json({ error: "Render upload metadata missing" }, { status: 422 });

  try {
    const asset = await registerWorkerRenderAsset({
      db,
      ownerId: job.owner_id,
      projectId: job.project_id,
      renderId,
      bucket,
      path,
      publicUrl,
      renderType: render.render_type,
      result,
    });
    const { error: renderUpdateError } = await db.from("music_video_renders").update({
      status: "completed",
      media_asset_id: asset.id,
      error: null,
    }).eq("id", render.id);
    if (renderUpdateError) throw new Error(renderUpdateError.message);

    if (render.render_type === "master_16_9") {
      const { error: projectError } = await db.from("music_video_projects").update({
        status: "complete",
        previous_status: null,
        last_error: null,
      }).eq("id", job.project_id);
      if (projectError) throw new Error(projectError.message);
    } else {
      const { error: projectError } = await db.from("music_video_projects")
        .update({ last_error: null })
        .eq("id", job.project_id);
      if (projectError) throw new Error(projectError.message);
    }

    await markWorkerTerminal(db, job.id, "completed", result, null);
    scheduleCleanup();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Render reconciliation failed" }, { status: 500 });
  }
}
