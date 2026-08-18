import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { registerWorkerRenderAsset } from "@/lib/video-director/assets";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.MEDIA_WORKER_SECRET?.trim();
  const authorization = request.headers.get("authorization") || "";
  if (!secret || !authorization.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // Ignore late/out-of-order callbacks only after the full terminal reconciliation has
  // completed. Terminal state is deliberately written last below.
  if (["completed", "failed"].includes(job.status)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (status === "running") {
    await db.from("music_video_worker_jobs")
      .update({ status: "running", started_at: job.started_at || new Date().toISOString(), error: null })
      .eq("id", job.id);
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    if (job.job_type === "analyze_audio") {
      await db.from("music_video_projects").update({
        previous_status: "analyzing_audio",
        status: "blocked",
        last_error: callbackError || "Audio analysis failed",
      }).eq("id", job.project_id);
    } else {
      const renderId = typeof record(job.request_payload).render_id === "string"
        ? record(job.request_payload).render_id as string
        : null;
      if (renderId) {
        const { data: render } = await db.from("music_video_renders")
          .select("render_type")
          .eq("id", renderId)
          .eq("project_id", job.project_id)
          .maybeSingle();
        await db.from("music_video_renders")
          .update({ status: "failed", error: callbackError || "Render failed" })
          .eq("id", renderId);
        if (render?.render_type === "master_16_9") {
          await db.from("music_video_projects").update({
            previous_status: "rendering",
            status: "ready_to_render",
            last_error: callbackError || "Master render failed",
          }).eq("id", job.project_id);
        } else {
          // A failed derived cut must never demote a project whose master is already complete.
          await db.from("music_video_projects")
            .update({ last_error: callbackError || "Derived render failed" })
            .eq("id", job.project_id);
        }
      }
    }
    await db.from("music_video_worker_jobs")
      .update({ status: "failed", error: callbackError || "Worker job failed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    return NextResponse.json({ ok: true });
  }

  if (job.job_type === "analyze_audio") {
    const musicMap = record(result.music_map);
    if (!Object.keys(musicMap).length) return NextResponse.json({ error: "Worker returned no music map" }, { status: 422 });
    const { error: projectError } = await db.from("music_video_projects").update({
      music_map: json(musicMap),
      status: "concept_review",
      previous_status: null,
      last_error: null,
      analysis_completed_at: new Date().toISOString(),
    }).eq("id", job.project_id);
    if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
    await db.from("music_video_worker_jobs").update({
      status: "completed",
      result_payload: json(result),
      error: null,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return NextResponse.json({ ok: true });
  }

  const requestPayload = record(job.request_payload);
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
  if (renderUpdateError) return NextResponse.json({ error: renderUpdateError.message }, { status: 500 });

  if (render.render_type === "master_16_9") {
    const { error: projectError } = await db.from("music_video_projects").update({
      status: "complete",
      previous_status: null,
      last_error: null,
    }).eq("id", job.project_id);
    if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  } else {
    await db.from("music_video_projects").update({ last_error: null }).eq("id", job.project_id);
  }

  // Terminal worker state is the commit marker and is intentionally written last. If any
  // reconciliation above fails, a repeated callback can safely finish the same operation.
  await db.from("music_video_worker_jobs").update({
    status: "completed",
    result_payload: json(result),
    error: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);
  return NextResponse.json({ ok: true });
}
