import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { getSiteUrl } from "@/lib/site-url";
import type { Json } from "@/types/database";
import type { MusicMap } from "./creative-director";
import type { ExtendedMusicVideoProject, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MEDIA_WORKER_CALLBACK_HASH_KEY = "__atlas_callback_token_sha256";
export const MEDIA_WORKER_SANDBOX_NAME = "atlas-media-worker-cache";
const DEFAULT_SANDBOX_IMAGE = "atlas-media-worker:latest";
const STALE_JOB_MS = 50 * 60 * 1000;
const HOBBY_MAX_SANDBOX_MS = 45 * 60 * 1000;

function sandboxImage() {
  return process.env.MEDIA_WORKER_IMAGE?.trim() || DEFAULT_SANDBOX_IMAGE;
}

function sandboxAvailable() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_TOKEN?.trim());
}

function json(value: unknown): Json {
  return value as Json;
}

function workerJobTimestamp(job: unknown) {
  if (!job || typeof job !== "object") return 0;
  const value = job as Record<string, unknown>;
  for (const key of ["started_at", "updated_at", "created_at"]) {
    if (typeof value[key] !== "string") continue;
    const timestamp = Date.parse(value[key]);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function activeWorkerJob(job: unknown) {
  if (!job || typeof job !== "object") return false;
  const value = job as Record<string, unknown>;
  if (!["queued", "running"].includes(String(value.status || ""))) return false;
  const timestamp = workerJobTimestamp(job);
  return timestamp > 0 && Date.now() - timestamp < STALE_JOB_MS;
}

function callbackCredential() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
  };
}

function sandboxDispatchError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/quota|limit|billing|payment|resource|429|hobby/i.test(detail)) {
    return "Vercel Hobby Sandbox quota is unavailable right now. Atlas did not use a paid fallback. Try again after the free quota resets.";
  }
  return `Vercel Sandbox dispatch failed: ${detail}`;
}

export function mediaWorkerReadiness() {
  return {
    configured: sandboxAvailable(),
    url: null,
    runtime: "vercel_sandbox" as const,
    image: sandboxImage(),
    sandboxName: MEDIA_WORKER_SANDBOX_NAME,
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
  if (!sandboxAvailable()) {
    throw new Error("Vercel Sandbox is only available from a Vercel deployment. Atlas did not use a paid fallback.");
  }

  const existing = await input.db.from("music_video_worker_jobs")
    .select("*")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.status === "completed") return existing.data;
  if (existing.data && activeWorkerJob(existing.data)) return existing.data;

  const busyJobs = await input.db.from("music_video_worker_jobs")
    .select("id,status,created_at,started_at")
    .eq("owner_id", input.ownerId)
    .in("status", ["queued", "running"])
    .limit(10);
  if (busyJobs.error) throw new Error(busyJobs.error.message);
  if ((busyJobs.data || []).some((candidate) => candidate.id !== existing.data?.id && activeWorkerJob(candidate))) {
    throw new Error("The free Media Worker is already processing another job. Atlas keeps concurrency at 1 to protect the Hobby quota.");
  }

  const credential = callbackCredential();
  const storedPayload = {
    ...input.payload,
    [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
  };

  const { data: job, error } = await input.db.from("music_video_worker_jobs")
    .upsert({
      owner_id: input.ownerId,
      project_id: input.project.id,
      job_type: input.jobType,
      status: "planned",
      idempotency_key: input.idempotencyKey,
      request_payload: json(storedPayload),
      result_payload: {},
      error: null,
      external_job_id: null,
      started_at: null,
      completed_at: null,
    }, { onConflict: "idempotency_key" })
    .select("*")
    .single();
  if (error || !job) throw new Error(error?.message || "Could not create media-worker job.");

  // A database trigger can resolve analyze_audio as a cache hit from the canonical
  // track_music_intelligence row. Never dispatch CPU work after that durable decision.
  if (job.status === "completed") return job;

  const callbackUrl = `${getSiteUrl()}/api/video-director/worker/callback`;
  let sandbox: Sandbox | null = null;

  try {
    // One named persistent Sandbox keeps the downloaded all-in-one/Demucs model cache
    // between jobs. The VM itself is stopped after every terminal callback, so there is
    // no idle CPU/memory burn. Keeping only one snapshot makes storage usage predictable.
    sandbox = await Sandbox.getOrCreate({
      name: MEDIA_WORKER_SANDBOX_NAME,
      image: sandboxImage(),
      resources: { vcpus: 4 },
      timeout: HOBBY_MAX_SANDBOX_MS,
      persistent: true,
      keepLastSnapshots: { count: 1 },
      tags: {
        app: "atlas-irwin",
        role: "media-worker",
      },
    });

    const requestPath = `/tmp/atlas-worker-${job.id}.json`;
    await sandbox.writeFile(requestPath, JSON.stringify({
      job_id: job.id,
      job_type: input.jobType,
      payload: input.payload,
      callback_url: callbackUrl,
      callback_token: credential.token,
    }));

    const { data: queued, error: queueError } = await input.db.from("music_video_worker_jobs")
      .update({
        status: "queued",
        external_job_id: MEDIA_WORKER_SANDBOX_NAME,
        error: null,
      })
      .eq("id", job.id)
      .select("*")
      .single();
    if (queueError || !queued) throw new Error(queueError?.message || "Could not mark worker job queued.");

    await sandbox.runCommand({
      cmd: "python",
      args: ["-m", "app.runner", requestPath],
      cwd: "/app",
      detached: true,
    });

    return queued;
  } catch (dispatchError) {
    const message = sandboxDispatchError(dispatchError);
    await input.db.from("music_video_worker_jobs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch {
        // The failed session may already have stopped. Preserve the named cache for retry.
      }
    }
    throw new Error(message);
  }
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
