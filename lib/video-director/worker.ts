import "server-only";

import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { mediaWorkerReadiness as sharedMediaWorkerReadiness } from "@/lib/media-worker/sandbox";
import type { Json } from "@/types/database";
import type { MusicMap } from "./creative-director";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function json(value: unknown): Json {
  return value as Json;
}

export function mediaWorkerReadiness() {
  const readiness = sharedMediaWorkerReadiness();
  return {
    configured: readiness.configured,
    url: null,
    runtime: readiness.runtime,
    sandboxName: readiness.sandboxName,
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
    provenance: "duration_only" as const,
  }));
  return {
    version: 3,
    duration_ms: durationMs,
    bpm: null,
    beat_confidence: 0,
    beats_ms: [],
    beat_positions: [],
    downbeats_ms: [],
    downbeat_source: "none",
    bars: [],
    phrases: [],
    sections,
    energy_curve: sections.flatMap((section) => [
      { ms: section.start_ms, value: Math.max(0, section.energy - 0.12) },
      { ms: section.end_ms, value: section.energy },
    ]),
    edit_points: editPoints,
    peaks_ms: [],
    hook_candidates: [],
    moments: {
      instant_hook: [],
      musical_identity: [],
      groove_loop: [],
      build_drop: [],
      climax: [],
      story_arc: [],
    },
    social_cuts: { "6": null, "8": null, "15": null, "30": null },
    social_cut_options: { "6": [], "8": [], "15": [], "30": [] },
    analysis: {
      engine: "duration-only-fallback",
      model: null,
      quality: "fallback",
      semantic_structure: false,
      real_downbeats: false,
      downbeat_source: "none",
      embeddings_used: false,
      activation_fps: null,
      config: "duration-only",
      confidence: { overall: 0, rhythm: 0, downbeats: 0, structure: 0, hooks: 0 },
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
  if (!sharedMediaWorkerReadiness().configured) {
    throw new Error("Vercel Sandbox is unavailable in this deployment. Atlas did not use a paid fallback.");
  }

  const existing = await input.db.from("music_video_worker_jobs")
    .select("*")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.status === "completed") return existing.data;
  if (existing.data && ["planned", "queued", "running"].includes(existing.data.status)) {
    await kickMediaWorkerQueue();
    const refreshed = await input.db.from("music_video_worker_jobs")
      .select("*").eq("id", existing.data.id).single();
    if (refreshed.error || !refreshed.data) throw new Error(refreshed.error?.message || "Could not reload media-worker job.");
    return refreshed.data;
  }

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
      external_job_id: null,
      started_at: null,
      completed_at: null,
    }, { onConflict: "idempotency_key" })
    .select("*")
    .single();
  if (error || !job) throw new Error(error?.message || "Could not create media-worker job.");
  if (job.status === "completed") return job;

  await kickMediaWorkerQueue();
  const refreshed = await input.db.from("music_video_worker_jobs")
    .select("*").eq("id", job.id).single();
  if (refreshed.error || !refreshed.data) throw new Error(refreshed.error?.message || "Could not reload queued media-worker job.");
  return refreshed.data;
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
