import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { registerWorkerRenderAsset } from "@/lib/video-director/assets";

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

  if (status === "running") {
    await db.from("music_video_worker_jobs")
      .update({ status: "running", started_at: job.started_at || new Date().toISOString(), error: null })
      .eq("id", job.id);
    return NextResponse.json({ ok: true });
  }

  if (status === "failed") {
    await db.from("music_video_worker_jobs")
      .update({ status: "failed", error: callbackError || "Worker job failed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    if (job.job_type === "analyze_audio") {
      await db.from("music_video_projects").update({
        previous_status: "analyzing_audio",
        status: "blocked",
        last_error: callbackError || "Audio analysis failed",
      }).eq("id", job.project_id);
    } else {
      const renderId = typeof record(job.request_payload).render_id === "string" ? record(job.request_payload).render_id as string : null;
      if (renderId) await db.from("music_video_renders").update({ status: "failed", error: callbackError || "Render failed" }).eq("id", renderId);
      await db.from("music_video_projects").update({ previous_status: "rendering", status: "ready_to_render", last_error: callbackError || "Render failed" }).eq("id", job.project_id);
    }
    return NextResponse.json({ ok: true });
  }

  await db.from("music_video_worker_jobs").update({
    status: "completed",
    result_payload: result,
    error: null,
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  if (job.job_type === "analyze_audio") {
    const musicMap = record(result.music_map);
    if (!Object.keys(musicMap).length) return NextResponse.json({ error: "Worker returned no music map" }, { status: 422 });
    await db.from("music_video_projects").update({
      music_map: musicMap,
      status: "concept_review",
      previous_status: null,
      last_error: null,
      analysis_completed_at: new Date().toISOString(),
    }).eq("id", job.project_id);
    return NextResponse.json({ ok: true });
  }

  const requestPayload = record(job.request_payload);
  const renderId = typeof requestPayload.render_id === "string" ? requestPayload.render_id : "";
  if (!renderId) return NextResponse.json({ error: "Render job has no render_id" }, { status: 422 });
  const { data: render, error: renderError } = await db.from("music_video_renders").select("*").eq("id", renderId).single();
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
  await db.from("music_video_renders").update({
    status: "completed",
    media_asset_id: asset.id,
    error: null,
  }).eq("id", render.id);
  if (render.render_type === "master_16_9") {
    await db.from("music_video_projects").update({
      status: "complete",
      previous_status: null,
      last_error: null,
    }).eq("id", job.project_id);
  } else {
    await db.from("music_video_projects").update({ last_error: null }).eq("id", job.project_id);
  }
  return NextResponse.json({ ok: true });
}
