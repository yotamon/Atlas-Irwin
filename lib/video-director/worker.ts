import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import type { Json } from "@/types/database";
import type { MusicMap } from "./creative-director";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function workerUrl() {
  return process.env.MEDIA_WORKER_URL?.trim().replace(/\/$/, "") || null;
}

function workerSecret() {
  return process.env.MEDIA_WORKER_SECRET?.trim() || null;
}

function json(value: unknown): Json {
  return value as Json;
}

export function mediaWorkerReadiness() {
  return {
    configured: Boolean(workerUrl() && workerSecret()),
    url: workerUrl(),
  };
}

export function fallbackMusicMap(durationSeconds: number): MusicMap {
  const durationMs = Math.max(1000, Math.round(durationSeconds * 1000));
  const sectionFractions = durationMs < 90000
    ? [0, 0.22, 0.52, 0.78, 1]
    : [0, 0.12, 0.3, 0.5, 0.68, 0.86, 1];
  const names = ["Intro", "Section 2", "Section 3", "Section 4", "Section 5", "Outro"];
  const energy = [0.28, 0.52, 0.74, 0.68, 0.42, 0.78];
  const sections = sectionFractions.slice(0, -1).map((fraction, index) => ({
    id: `fallback-${index + 1}`,
    label: names[index] ?? `Section ${index + 1}`,
    type: index === 0 ? "intro" : index === sectionFractions.length - 2 ? "outro" : "section",
    start_ms: Math.round(fraction * durationMs),
    end_ms: Math.round(sectionFractions[index + 1] * durationMs),
    energy: energy[index] ?? 0.6,
    confidence: null,
  }));
  const editPoints = sections.slice(1).map((section) => ({
    ms: section.start_ms,
    confidence: 0.25,
    reason: "Estimated boundary from track duration only. Run real audio analysis before using it as an edit decision.",
  }));
  return {
    version: 2,
    duration_ms: durationMs,
    bpm: null,
    beat_confidence: 0,
    beats_ms: [],
    beat_positions: [],
    downbeats_ms: [],
    sections,
    energy_curve: sections.flatMap((section) => [
      { ms: section.start_ms, value: Math.max(0, section.energy - 0.12) },
      { ms: section.end_ms, value: section.energy },
    ]),
    edit_points: editPoints,
    peaks_ms: [],
    hook_candidates: [],
    social_cuts: { "6": null, "8": null, "15": null, "30": null },
    analysis: {
      engine: "duration-only-fallback",
      model: null,
      quality: "fallback",
      semantic_structure: false,
      real_downbeats: false,
      warnings: ["This map was estimated without inspecting the audio."],
    },
    source: "fallback",
  };
}

type WorkerJobType =
  | "analyze_audio"
  | "extract_frame"
  | "render_master"
  | "render_social"
  | "render_promo"
  | "render_hook";

export async function queueMediaWorkerJob(input: {
  db: SupabaseClient<VideoDatabase>;
  project: ExtendedMusicVideoProject;
  ownerId: string;
  jobType: WorkerJobType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}) {
  const base = workerUrl();
  const secret = workerSecret();
  if (!base || !secret) throw new Error("Media Worker is not configured.");

  const existing = await input.db.from("music_video_worker_jobs")
    .select("*")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data && ["queued", "running", "completed"].includes(existing.data.status)) return existing.data;

  const { data: job, error } = await input.db.from("music_video_worker_jobs")
    .upsert({
      owner_id: input.ownerId,
      project_id: input.project.id,
      job_type: input.jobType,
      status: "planned",
      idempotency_key: input.idempotencyKey,
      request_payload: json(input.payload),
      result_payload: {},
      error: null,
    }, { onConflict: "idempotency_key" })
    .select("*")
    .single();
  if (error || !job) throw new Error(error?.message || "Could not create media-worker job.");

  // A database trigger can resolve analyze_audio as a cache hit from the canonical
  // track_music_intelligence row. Never dispatch paid/CPU work after that durable decision.
  if (job.status === "completed") return job;

  const callbackUrl = `${getSiteUrl()}/api/video-director/worker/callback`;
  const response = await fetch(`${base}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      job_id: job.id,
      job_type: input.jobType,
      payload: input.payload,
      callback_url: callbackUrl,
      callback_token: secret,
    }),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    await input.db.from("music_video_worker_jobs")
      .update({ status: "failed", error: `Worker dispatch failed (${response.status})` })
      .eq("id", job.id);
    throw new Error(typeof result.detail === "string" ? result.detail : `Media Worker dispatch failed (${response.status}).`);
  }
  const externalJobId = typeof result.job_id === "string" ? result.job_id : job.id;
  const { data: queued, error: queueError } = await input.db.from("music_video_worker_jobs")
    .update({ status: "queued", external_job_id: externalJobId })
    .eq("id", job.id)
    .select("*")
    .single();
  if (queueError || !queued) throw new Error(queueError?.message || "Could not mark worker job queued.");
  return queued;
}

async function createWorkerUploadTarget(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
  fileName: string,
) {
  const bucket = "public-media";
  const path = `${ownerId}/library/video-director/${projectId}/${fileName}`;
  const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message || "Could not prepare worker upload target.");
  return {
    bucket,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
    publicUrl: db.storage.from(bucket).getPublicUrl(data.path).data.publicUrl,
  };
}

export function createWorkerRenderUploadTarget(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
  renderId: string,
) {
  return createWorkerUploadTarget(db, ownerId, projectId, `${renderId}.mp4`);
}

export function createWorkerThumbnailUploadTarget(
  db: SupabaseClient<VideoDatabase>,
  ownerId: string,
  projectId: string,
  candidateId: string,
) {
  return createWorkerUploadTarget(db, ownerId, projectId, `thumbnail-${candidateId}.jpg`);
}
