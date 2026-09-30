import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createMediaWorkerCallbackCredential,
  dispatchMediaWorkerJob,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  mediaWorkerReadiness,
} from "@/lib/media-worker/sandbox";
import {
  classifyBackgroundFailure,
  clearRetryMetadata,
  retryDelayMs,
  retryNotBefore,
  withRetryMetadata,
} from "@/lib/media-worker/retry-policy.mjs";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";
import type { MarketingMediaDatabase, MarketingMediaJob } from "@/types/marketing-media-database";

const STALE_JOB_MS = 50 * 60 * 1000;
const DISPATCH_CLAIM_MS = 2 * 60 * 1000;
type WorkerScope = { ownerId: string; artistId: string };

function client() {
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

function timestamp(value: unknown) {
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withoutCredential(payload: Record<string, unknown>) {
  const clean = { ...payload };
  delete clean[MEDIA_WORKER_CALLBACK_HASH_KEY];
  return clean;
}

async function state(db: ReturnType<typeof client>, scope?: WorkerScope) {
  let query = db.from("marketing_media_jobs")
    .select("*")
    .in("status", ["planned", "queued", "running"]);
  if (scope) query = query.eq("owner_id", scope.ownerId).eq("artist_id", scope.artistId);
  const { data, error } = await query.order("created_at").limit(100);
  if (error) throw new Error(error.message);
  const planned: MarketingMediaJob[] = [];
  let active = false;
  let deferred = 0;
  const now = Date.now();

  for (const row of data ?? []) {
    const job = row as MarketingMediaJob;
    if (job.status === "planned") {
      if (retryNotBefore(record(job.request_payload)) > now) {
        deferred += 1;
        continue;
      }
      planned.push(job);
      continue;
    }
    const lastActivity = timestamp(job.started_at) || timestamp(job.updated_at) || timestamp(job.created_at);
    const age = lastActivity ? Date.now() - lastActivity : Number.POSITIVE_INFINITY;
    if (job.status === "queued" && !job.external_job_id && age > DISPATCH_CLAIM_MS) {
      const nextStatus = job.attempt_count >= job.max_attempts ? "failed" : "planned";
      const cleanPayload = withoutCredential(record(job.request_payload));
      const retryPayload = nextStatus === "planned"
        ? withRetryMetadata(cleanPayload, "transient", Math.max(1, job.attempt_count))
        : cleanPayload;
      const { error: recoverError } = await db.from("marketing_media_jobs").update({
        status: nextStatus,
        request_payload: json(retryPayload),
        external_job_id: null,
        error: nextStatus === "failed" ? "Marketing media dispatch repeatedly stalled before worker ownership was established." : null,
        started_at: null,
        completed_at: nextStatus === "failed" ? new Date().toISOString() : null,
      }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id).eq("status", "queued").is("external_job_id", null);
      if (recoverError) throw new Error(recoverError.message);
      if (nextStatus === "planned") deferred += 1;
      continue;
    }
    if (lastActivity && age < STALE_JOB_MS) {
      active = true;
      continue;
    }
    const nextStatus = job.attempt_count >= job.max_attempts ? "failed" : "planned";
    const cleanPayload = withoutCredential(record(job.request_payload));
    const retryPayload = nextStatus === "planned"
      ? withRetryMetadata(cleanPayload, "transient", Math.max(1, job.attempt_count))
      : cleanPayload;
    const { error: staleError } = await db.from("marketing_media_jobs").update({
      status: nextStatus,
      request_payload: json(retryPayload),
      external_job_id: null,
      error: nextStatus === "failed" ? "Marketing media job became stale before a terminal callback was received." : null,
      started_at: null,
      completed_at: nextStatus === "failed" ? new Date().toISOString() : null,
    }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id).in("status", ["queued", "running"]);
    if (staleError) throw new Error(staleError.message);
    if (nextStatus === "planned") deferred += 1;
  }
  return {
    active,
    deferred,
    planned: planned.sort((a, b) => timestamp(a.created_at) - timestamp(b.created_at)),
  };
}

async function freshUploadPayload(payload: Record<string, unknown>) {
  const service = createServiceClient();
  const bucket = typeof payload.upload_bucket === "string" ? payload.upload_bucket : "public-media";
  const path = typeof payload.upload_path === "string" ? payload.upload_path : "";
  if (!path) throw new Error("Marketing media job is missing its output storage path.");
  const outputSigned = await service.storage.from(bucket).createSignedUploadUrl(path);
  if (outputSigned.error || !outputSigned.data?.signedUrl) {
    throw new Error(outputSigned.error?.message || "Could not mint a fresh marketing video upload credential.");
  }

  const rawFrames = Array.isArray(payload.review_frames) ? payload.review_frames : [];
  const reviewFrames = [] as Array<Record<string, unknown>>;
  for (const raw of rawFrames.slice(0, 8)) {
    const frame = record(raw);
    const frameBucket = typeof frame.upload_bucket === "string" ? frame.upload_bucket : bucket;
    const framePath = typeof frame.upload_path === "string" ? frame.upload_path : "";
    if (!framePath) continue;
    const signed = await service.storage.from(frameBucket).createSignedUploadUrl(framePath);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message || "Could not mint a fresh marketing QC-frame upload credential.");
    }
    reviewFrames.push({ ...frame, upload_url: signed.data.signedUrl });
  }
  return {
    ...payload,
    upload_url: outputSigned.data.signedUrl,
    review_frames: reviewFrames,
  };
}

async function dispatch(db: ReturnType<typeof client>, job: MarketingMediaJob) {
  const requestPayload = clearRetryMetadata(withoutCredential(record(job.request_payload)));
  if (requestPayload.artist_id !== job.artist_id) throw new Error("Marketing media job payload does not match its artist lineage.");
  const credential = createMediaWorkerCallbackCredential();
  const { data: claimed, error: claimError } = await db.from("marketing_media_jobs").update({
    status: "queued",
    request_payload: json({ ...requestPayload, [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash }),
    attempt_count: job.attempt_count + 1,
    external_job_id: null,
    error: null,
    started_at: null,
    completed_at: null,
  }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id).eq("status", "planned").select("*").maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { dispatched: false as const, errorClass: "busy" as const, terminal: false };

  try {
    const dispatchPayload = await freshUploadPayload(requestPayload);
    const result = await dispatchMediaWorkerJob({
      jobId: claimed.id,
      jobType: "finish_social_video",
      payload: dispatchPayload,
      callbackUrl: `${getSiteUrl()}/api/studio/marketing/media-worker/callback`,
      callbackToken: credential.token,
    });
    const { error: updateError } = await db.from("marketing_media_jobs")
      .update({ external_job_id: result.sandboxName })
      .eq("id", claimed.id).eq("owner_id", claimed.owner_id).eq("artist_id", claimed.artist_id);
    if (updateError) throw new Error(updateError.message);
    return { dispatched: true as const, errorClass: null, terminal: false };
  } catch (error) {
    const errorClass = classifyBackgroundFailure(error);
    const message = error instanceof Error ? error.message : "Marketing Media Worker dispatch failed.";
    const terminal = errorClass === "terminal" || claimed.attempt_count >= claimed.max_attempts;
    const retryPayload = terminal
      ? requestPayload
      : withRetryMetadata(requestPayload, errorClass, claimed.attempt_count);
    await db.from("marketing_media_jobs").update({
      status: terminal ? "failed" : "planned",
      request_payload: json(retryPayload),
      external_job_id: null,
      error: terminal ? message : `${message} Retry delayed by ${retryDelayMs(errorClass, claimed.attempt_count)}ms.`,
      completed_at: terminal ? new Date().toISOString() : null,
    }).eq("id", claimed.id).eq("owner_id", claimed.owner_id).eq("artist_id", claimed.artist_id);
    if (terminal && claimed.generation_run_id) {
      const { data: run } = await db.from("generation_runs").select("output")
        .eq("id", claimed.generation_run_id).eq("owner_id", claimed.owner_id).eq("artist_id", claimed.artist_id).maybeSingle();
      const output = record(run?.output);
      await db.from("generation_runs").update({
        output: json({ ...output, stage: "finishing_failed", finishingError: message }),
      }).eq("id", claimed.generation_run_id).eq("owner_id", claimed.owner_id).eq("artist_id", claimed.artist_id);
    }
    return { dispatched: false as const, errorClass, terminal };
  }
}

export async function kickMarketingMediaWorkerQueue(scope?: WorkerScope) {
  if (!mediaWorkerReadiness().configured) return { dispatched: false, reason: "unavailable" as const };
  const db = client();
  const current = await state(db, scope);
  if (current.active) return { dispatched: false, reason: "busy" as const };
  const job = current.planned[0] ?? null;
  if (!job) {
    return current.deferred > 0
      ? { dispatched: false, reason: "backoff" as const, deferred: current.deferred }
      : { dispatched: false, reason: "empty" as const };
  }
  const result = await dispatch(db, job);
  if (result.dispatched) return { dispatched: true, reason: "started" as const, jobId: job.id };
  return {
    dispatched: false,
    reason: result.terminal ? "failed" as const : "backoff" as const,
    errorClass: result.errorClass,
    jobId: job.id,
  };
}
