import "server-only";

import {
  createMediaWorkerCallbackCredential,
  dispatchMediaWorkerJob,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  mediaWorkerReadiness,
} from "@/lib/media-worker/sandbox";
import { getSiteUrl } from "@/lib/site-url";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
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

type DispatchableWorkerJobType = "analyze_audio" | "extract_frame" | "render_master" | "render_social" | "render_promo" | "render_hook";

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

    // `queued` is also the short dispatch-claim state. If the request process died before
    // Sandbox returned its external id there is no worker to call us back, so recover quickly.
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

    // A Vault row can likewise be claimed as `dispatched` before the Sandbox request exists.
    // Absence of started_at plus an old claim means it is safe to put the durable request back.
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
  const db = videoDb();
  const [videoActive, vaultState] = await Promise.all([
    freshVideoActive(db),
    vaultQueueState(),
  ]);
  if (videoActive || vaultState.active) return { dispatched: false, reason: "busy" as const };

  const video = await oldestVideoPlanned(db);
  const vault = [...vaultState.queued].sort((a, b) => vaultRequestedAt(a) - vaultRequestedAt(b))[0] ?? null;
  if (!video && !vault) return { dispatched: false, reason: "empty" as const };

  const chooseVault = Boolean(vault && (!video || vaultRequestedAt(vault) < timestamp(video.created_at)));
  const dispatched = chooseVault && vault
    ? await dispatchVaultTrack(vaultState.growth, vault)
    : video
      ? await dispatchVideoJob(db, video)
      : false;
  return { dispatched, reason: dispatched ? "started" as const : "busy" as const };
}
