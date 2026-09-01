import "server-only";

import {
  createMediaWorkerCallbackCredential,
  dispatchMediaWorkerJob,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  mediaWorkerReadiness,
} from "@/lib/media-worker/sandbox";
import { asStemClient } from "@/lib/music-intelligence/stem-scenes";
import { getSiteUrl } from "@/lib/site-url";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { StemDatabase, TrackStemJob } from "@/types/stem-database";
import type { MusicVideoWorkerJob, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

const STALE_JOB_MS = 50 * 60 * 1000;
const DISPATCH_CLAIM_MS = 2 * 60 * 1000;
const SUPPORTED_VIDEO_JOB_TYPES = new Set<MusicVideoWorkerJob["job_type"]>([
  "analyze_audio",
  "extract_frame",
  "render_master",
  "render_social",
  "render_promo",
  "render_hook",
]);

type DispatchableWorkerJobType =
  | "analyze_audio"
  | "analyze_stem"
  | "extract_frame"
  | "render_master"
  | "render_social"
  | "render_promo"
  | "render_hook"
  | "render_audio_scene";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function busyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already processing|worker is busy/i.test(message);
}

function withoutCredential(payload: Record<string, unknown>) {
  const result = { ...payload };
  delete result[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return result;
}

function videoDb() {
  return createServiceClient() as unknown as SupabaseClient<VideoDatabase>;
}

function stemDb() {
  return asStemClient(createServiceClient()) as SupabaseClient<StemDatabase>;
}

async function freshVideoActive(db: SupabaseClient<VideoDatabase>) {
  const { data, error } = await db.from("music_video_worker_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("updated_at")
    .limit(20);
  if (error) throw new Error(error.message);
  let active = false;
  for (const job of data ?? []) {
    const lastActivity = timestamp(job.started_at) || timestamp(job.updated_at) || timestamp(job.created_at);
    const age = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;

    if (job.status === "queued" && !job.external_job_id && age > DISPATCH_CLAIM_MS) {
      const { error: recoverError } = await db.from("music_video_worker_jobs").update({
        status: "planned",
        request_payload: json(withoutCredential(record(job.request_payload))),
        error: null,
        started_at: null,
        completed_at: null,
      }).eq("id", job.id).eq("status", "queued").is("external_job_id", null);
      if (recoverError) throw new Error(recoverError.message);
      continue;
    }

    if (lastActivity && age < STALE_JOB_MS) {
      active = true;
      continue;
    }
    await db.from("music_video_worker_jobs").update({
      status: "failed",
      request_payload: json(withoutCredential(record(job.request_payload))),
      error: "Media Worker job became stale before a terminal callback was received.",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id).in("status", ["queued", "running"]);
  }
  return active;
}

async function freshStemState(db: SupabaseClient<StemDatabase>) {
  const { data, error } = await db.from("track_stem_jobs")
    .select("*")
    .in("status", ["planned", "queued", "running"])
    .order("created_at")
    .limit(200);
  if (error) throw new Error(error.message);
  let active = false;
  const planned: TrackStemJob[] = [];
  for (const job of data ?? []) {
    const typed = job as TrackStemJob;
    if (typed.status === "planned") {
      planned.push(typed);
      continue;
    }
    const lastActivity = timestamp(typed.started_at) || timestamp(typed.updated_at) || timestamp(typed.created_at);
    const age = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;
    if (typed.status === "queued" && !typed.external_job_id && age > DISPATCH_CLAIM_MS) {
      const { error: recoverError } = await db.from("track_stem_jobs").update({
        status: "planned",
        request_payload: json(withoutCredential(record(typed.request_payload))),
        error: null,
        started_at: null,
        completed_at: null,
      }).eq("id", typed.id).eq("status", "queued").is("external_job_id", null);
      if (recoverError) throw new Error(recoverError.message);
      planned.push({ ...typed, status: "planned", external_job_id: null });
      continue;
    }
    if (lastActivity && age < STALE_JOB_MS) {
      active = true;
      continue;
    }
    await db.from("track_stem_jobs").update({
      status: "failed",
      request_payload: json(withoutCredential(record(typed.request_payload))),
      error: "Stem Intelligence job became stale before a terminal callback was received.",
      completed_at: new Date().toISOString(),
    }).eq("id", typed.id).in("status", ["queued", "running"]);
    if (typed.job_type === "analyze_stem" && typed.stem_id) {
      await db.from("track_stems").update({
        status: "failed",
        error: "Stem analysis became stale before the worker returned.",
      }).eq("id", typed.stem_id).eq("owner_id", typed.owner_id);
    }
    if (typed.job_type === "render_audio_scene" && typed.scene_id) {
      await db.from("audio_scenes").update({
        status: "failed",
        preview_error: "Audio Scene render became stale before the worker returned.",
      }).eq("id", typed.scene_id).eq("owner_id", typed.owner_id);
    }
  }
  return { active, planned };
}

async function vaultQueueState() {
  const service = createServiceClient();
  const growth = asGrowthClient(service);
  const { data, error } = await growth.from("track_vault")
    .select("*")
    .order("updated_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  let active = false;
  const queued = [] as NonNullable<typeof data>;
  for (const track of data ?? []) {
    const analysis = record(track.analysis);
    const status = typeof analysis.status === "string" ? analysis.status : "";
    if (status === "queued") {
      queued.push(track);
      continue;
    }
    if (!["dispatched", "running"].includes(status)) continue;
    const lastActivity = timestamp(analysis.started_at)
      || timestamp(analysis.dispatched_at)
      || timestamp(analysis.requested_at)
      || timestamp(track.updated_at);
    const age = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;

    if (status === "dispatched" && !timestamp(analysis.started_at) && age > DISPATCH_CLAIM_MS) {
      const recovered = {
        ...withoutCredential(analysis),
        status: "queued",
        dispatched_at: null,
      };
      const { error: recoverError } = await growth.from("track_vault").update({ analysis: json(recovered) }).eq("id", track.id);
      if (recoverError) throw new Error(recoverError.message);
      queued.push({ ...track, analysis: json(recovered) });
      continue;
    }

    if (lastActivity && age < STALE_JOB_MS) {
      active = true;
      continue;
    }
    await growth.from("track_vault").update({
      analysis: json({
        ...withoutCredential(analysis),
        status: "failed",
        message: "Track analysis became stale before a terminal callback was received.",
        completed_at: new Date().toISOString(),
      }),
    }).eq("id", track.id);
  }
  return { active, queued, growth };
}

async function oldestVideoPlanned(db: SupabaseClient<VideoDatabase>) {
  const { data, error } = await db.from("music_video_worker_jobs")
    .select("*")
    .eq("status", "planned")
    .order("created_at")
    .limit(20);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;

  const unsupported = data.filter((job) => !SUPPORTED_VIDEO_JOB_TYPES.has(job.job_type));
  for (const job of unsupported) {
    await db.from("music_video_worker_jobs").update({
      status: "failed",
      error: `Unsupported Media Worker job type: ${job.job_type}`,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id).eq("status", "planned");
  }
  const supported = data.filter((job) => SUPPORTED_VIDEO_JOB_TYPES.has(job.job_type));
  if (!supported.length) return null;
  return [...supported].sort((a, b) => {
    const analysisPriority = Number(b.job_type === "analyze_audio") - Number(a.job_type === "analyze_audio");
    if (analysisPriority) return analysisPriority;
    return timestamp(a.created_at) - timestamp(b.created_at);
  })[0];
}

function vaultRequestedAt(track: { analysis: Json; updated_at: string }) {
  const analysis = record(track.analysis);
  return timestamp(analysis.requested_at) || timestamp(track.updated_at);
}

async function dispatchVideoJob(db: SupabaseClient<VideoDatabase>, job: MusicVideoWorkerJob) {
  if (!SUPPORTED_VIDEO_JOB_TYPES.has(job.job_type)) return false;
  const requestPayload = withoutCredential(record(job.request_payload));
  const credential = createMediaWorkerCallbackCredential();
  const { data: claimed, error: claimError } = await db.from("music_video_worker_jobs")
    .update({
      status: "queued",
      request_payload: json({ ...requestPayload, [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash }),
      error: null,
      external_job_id: null,
      started_at: null,
      completed_at: null,
    })
    .eq("id", job.id)
    .eq("status", "planned")
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return false;

  try {
    const dispatch = await dispatchMediaWorkerJob({
      jobId: claimed.id,
      jobType: claimed.job_type as DispatchableWorkerJobType,
      payload: requestPayload,
      callbackUrl: `${getSiteUrl()}/api/video-director/worker/callback`,
      callbackToken: credential.token,
    });
    await db.from("music_video_worker_jobs")
      .update({ external_job_id: dispatch.sandboxName, error: null })
      .eq("id", claimed.id);
    return true;
  } catch (error) {
    if (busyError(error)) {
      await db.from("music_video_worker_jobs").update({
        status: "planned",
        request_payload: json(requestPayload),
        external_job_id: null,
        error: null,
      }).eq("id", claimed.id);
      return false;
    }
    const message = error instanceof Error ? error.message : "Media Worker dispatch failed.";
    await db.from("music_video_worker_jobs").update({
      status: "failed",
      request_payload: json(requestPayload),
      error: message,
      completed_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    throw new Error(message);
  }
}

async function prepareStemPayloadForDispatch(
  db: SupabaseClient<StemDatabase>,
  job: TrackStemJob,
  payload: Record<string, unknown>,
) {
  if (job.job_type !== "render_audio_scene") return payload;
  const bucket = typeof payload.upload_bucket === "string" ? payload.upload_bucket : "";
  const path = typeof payload.upload_path === "string" ? payload.upload_path : "";
  if (!bucket || !path) {
    throw new Error("Audio Scene render job is missing its upload destination.");
  }
  const signed = await db.storage.from(bucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message || "Could not create a fresh Audio Scene upload credential.");
  }
  return { ...payload, upload_url: signed.data.signedUrl };
}

async function dispatchStemJob(db: SupabaseClient<StemDatabase>, job: TrackStemJob) {
  const requestPayload = withoutCredential(record(job.request_payload));
  const credential = createMediaWorkerCallbackCredential();
  const { data: claimed, error: claimError } = await db.from("track_stem_jobs")
    .update({
      status: "queued",
      request_payload: json({ ...requestPayload, [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash }),
      error: null,
      external_job_id: null,
      started_at: null,
      completed_at: null,
    })
    .eq("id", job.id)
    .eq("status", "planned")
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return false;

  try {
    const dispatchPayload = await prepareStemPayloadForDispatch(db, claimed as TrackStemJob, requestPayload);
    const dispatch = await dispatchMediaWorkerJob({
      jobId: claimed.id,
      jobType: claimed.job_type as DispatchableWorkerJobType,
      payload: dispatchPayload,
      callbackUrl: `${getSiteUrl()}/api/studio/stems/callback`,
      callbackToken: credential.token,
    });
    await db.from("track_stem_jobs").update({ external_job_id: dispatch.sandboxName }).eq("id", claimed.id);
    return true;
  } catch (error) {
    if (busyError(error)) {
      await db.from("track_stem_jobs").update({
        status: "planned",
        request_payload: json(requestPayload),
        external_job_id: null,
        error: null,
      }).eq("id", claimed.id);
      return false;
    }
    const message = error instanceof Error ? error.message : "Stem Intelligence dispatch failed.";
    await db.from("track_stem_jobs").update({
      status: "failed",
      request_payload: json(requestPayload),
      error: message,
      completed_at: new Date().toISOString(),
    }).eq("id", claimed.id);
    if (claimed.job_type === "analyze_stem" && claimed.stem_id) {
      await db.from("track_stems").update({ status: "failed", error: message }).eq("id", claimed.stem_id);
    }
    if (claimed.job_type === "render_audio_scene" && claimed.scene_id) {
      await db.from("audio_scenes").update({ status: "failed", preview_error: message }).eq("id", claimed.scene_id);
    }
    throw new Error(message);
  }
}

async function dispatchVaultTrack(
  growth: ReturnType<typeof asGrowthClient>,
  track: {
    id: string;
    media_asset_id: string | null;
    audio_url: string | null;
    analysis: Json;
  },
) {
  const analysis = record(track.analysis);
  const requestId = typeof analysis.request_id === "string" ? analysis.request_id : "";
  if (!requestId || !track.audio_url) {
    await growth.from("track_vault").update({
      analysis: json({
        ...withoutCredential(analysis),
        status: "failed",
        message: "Queued track analysis is missing its request id or audio URL.",
        completed_at: new Date().toISOString(),
      }),
    }).eq("id", track.id);
    return false;
  }

  const credential = createMediaWorkerCallbackCredential();
  const dispatchedAnalysis = {
    ...withoutCredential(analysis),
    status: "dispatched",
    dispatched_at: new Date().toISOString(),
    [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
  };
  const { data: claimed, error: claimError } = await growth.from("track_vault")
    .update({ analysis: json(dispatchedAnalysis) })
    .eq("id", track.id)
    .select("*")
    .single();
  if (claimError || !claimed) throw new Error(claimError?.message || "Could not claim queued track analysis.");

  try {
    await dispatchMediaWorkerJob({
      jobId: `${track.id}:${requestId}`,
      jobType: "analyze_audio",
      payload: {
        audio_url: track.audio_url,
        source_audio_url: track.audio_url,
        source_media_asset_id: track.media_asset_id,
      },
      callbackUrl: `${getSiteUrl()}/api/studio/growth/audio-callback`,
      callbackToken: credential.token,
    });
    return true;
  } catch (error) {
    if (busyError(error)) {
      await growth.from("track_vault").update({
        analysis: json({ ...withoutCredential(dispatchedAnalysis), status: "queued", dispatched_at: null }),
      }).eq("id", track.id);
      return false;
    }
    const message = error instanceof Error ? error.message : "Media Worker dispatch failed.";
    await growth.from("track_vault").update({
      analysis: json({
        ...withoutCredential(dispatchedAnalysis),
        status: "failed",
        message,
        completed_at: new Date().toISOString(),
      }),
    }).eq("id", track.id);
    throw new Error(message);
  }
}

export async function kickMediaWorkerQueue() {
  if (!mediaWorkerReadiness().configured) return { dispatched: false, reason: "unavailable" as const };
  const video = videoDb();
  const stems = stemDb();
  const [videoActive, vaultState, stemState] = await Promise.all([
    freshVideoActive(video),
    vaultQueueState(),
    freshStemState(stems),
  ]);
  if (videoActive || vaultState.active || stemState.active) return { dispatched: false, reason: "busy" as const };

  const videoJob = await oldestVideoPlanned(video);
  const vault = [...vaultState.queued].sort((a, b) => vaultRequestedAt(a) - vaultRequestedAt(b))[0] ?? null;
  const stemJob = [...stemState.planned].sort((a, b) => timestamp(a.created_at) - timestamp(b.created_at))[0] ?? null;
  if (!videoJob && !vault && !stemJob) return { dispatched: false, reason: "empty" as const };

  const choices = [
    videoJob ? { kind: "video" as const, at: timestamp(videoJob.created_at) } : null,
    vault ? { kind: "vault" as const, at: vaultRequestedAt(vault) } : null,
    stemJob ? { kind: "stem" as const, at: timestamp(stemJob.created_at) } : null,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value)).sort((a, b) => a.at - b.at);

  const selected = choices[0]?.kind;
  const dispatched = selected === "vault" && vault
    ? await dispatchVaultTrack(vaultState.growth, vault)
    : selected === "stem" && stemJob
      ? await dispatchStemJob(stems, stemJob)
      : videoJob
        ? await dispatchVideoJob(video, videoJob)
        : false;
  return { dispatched, reason: dispatched ? "started" as const : "busy" as const };
}
