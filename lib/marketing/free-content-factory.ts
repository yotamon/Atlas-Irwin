import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
  mediaWorkerReadiness,
} from "@/lib/media-worker/sandbox";
import {
  classifyBackgroundFailure,
  clearRetryMetadata,
  retryAt,
} from "@/lib/media-worker/retry-policy.mjs";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { AutomationJob } from "@/types/marketing-database";
import { createMarketingServiceClient } from "./db";

const SANDBOX_SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;
const OUTPUT_SECONDS = 15;
const BUCKET = "public-media";
const DAILY_RENDER_LIMIT = 2;
const MONTHLY_RENDER_LIMIT = 40;
const COMPOSITION_HORIZON_HOURS = 36;
const CONTENT_FACTORY_JOB_TYPE = "free_content_factory_render";
const CONTENT_FACTORY_JOB_VERSION = 2;

const TEMPLATES = [
  "deep_zoom",
  "slow_drift",
  "glass_echo",
  "mono_pulse",
  "warm_bloom",
  "club_flash",
  "soft_focus",
  "minimal_frame",
] as const;

type Template = (typeof TEMPLATES)[number];
type ScopedAutomationJob = AutomationJob & { artist_id: string };

function asJson(value: unknown) {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function templateFor(seed: string): Template {
  const byte = createHash("sha256").update(seed).digest()[0];
  return TEMPLATES[byte % TEMPLATES.length];
}

function utcDayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function utcMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function composerQuota() {
  const marketing = createMarketingServiceClient();
  const now = new Date();
  const base = () => marketing.from("generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("provider", "atlas-free-composer")
    .eq("status", "completed");

  const [daily, monthly] = await Promise.all([
    base().gte("created_at", utcDayStart(now)),
    base().gte("created_at", utcMonthStart(now)),
  ]);
  if (daily.error) throw new Error(daily.error.message);
  if (monthly.error) throw new Error(monthly.error.message);

  const dailyUsed = daily.count ?? 0;
  const monthlyUsed = monthly.count ?? 0;
  return {
    dailyUsed,
    monthlyUsed,
    dailyLimit: DAILY_RENDER_LIMIT,
    monthlyLimit: MONTHLY_RENDER_LIMIT,
    allowed: dailyUsed < DAILY_RENDER_LIMIT && monthlyUsed < MONTHLY_RENDER_LIMIT,
  };
}

function duplicateError(error: { code?: string; message?: string } | null) {
  return error?.code === "23505" || /duplicate|unique/i.test(error?.message ?? "");
}

function contentFactoryIdempotencyKey(contentItemId: string) {
  return `free-content-factory:${contentItemId}:v${CONTENT_FACTORY_JOB_VERSION}`;
}

export async function enqueueOneMissingScheduledAsset() {
  const quota = await composerQuota();
  if (!quota.allowed) return { outcome: "free_quota_exhausted" as const, ...quota };

  const marketing = createMarketingServiceClient();
  const horizon = new Date(Date.now() + COMPOSITION_HORIZON_HOURS * 3_600_000).toISOString();
  const { data, error } = await marketing.from("content_items")
    .select("id,owner_id,artist_id,campaign_id,release_id,scheduled_at,asset_url,status")
    .is("asset_url", null)
    .not("release_id", "is", null)
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", horizon)
    .not("status", "in", '("Published","Archived")')
    .order("scheduled_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { outcome: "nothing_missing" as const, ...quota };
  if (!data.artist_id) throw new Error("Scheduled content is missing artist scope.");

  const idempotencyKey = contentFactoryIdempotencyKey(data.id);
  const { data: inserted, error: insertError } = await marketing.from("automation_jobs").insert({
    owner_id: data.owner_id,
    artist_id: data.artist_id,
    campaign_id: data.campaign_id,
    job_type: CONTENT_FACTORY_JOB_TYPE,
    payload: asJson({
      content_item_id: data.id,
      artist_id: data.artist_id,
      release_id: data.release_id,
    }),
    status: "queued",
    requires_approval: false,
    approval_status: "not_required",
    run_after: new Date().toISOString(),
    max_attempts: 4,
    idempotency_key: idempotencyKey,
  }).select("*").maybeSingle();

  let job = inserted as ScopedAutomationJob | null;
  if (insertError) {
    if (!duplicateError(insertError)) throw new Error(insertError.message);
    const existing = await marketing.from("automation_jobs")
      .select("*")
      .eq("owner_id", data.owner_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error || !existing.data) {
      throw new Error(existing.error?.message || "Could not recover durable Content Factory job.");
    }
    job = existing.data as unknown as ScopedAutomationJob;
  }
  if (!job) throw new Error("Content Factory job could not be persisted.");

  return {
    outcome: job.status === "queued" ? "queued" as const : "existing" as const,
    jobId: job.id,
    jobStatus: job.status,
    contentItemId: data.id,
    ...quota,
  };
}

async function loadRenderContext(job: ScopedAutomationJob) {
  const marketing = createMarketingServiceClient();
  const db = createServiceClient();
  const payload = record(job.payload);
  const contentItemId = typeof payload.content_item_id === "string" ? payload.content_item_id : "";
  if (!contentItemId) throw new Error("Content Factory job is missing content_item_id.");

  const { data: item, error: itemError } = await marketing.from("content_items")
    .select("*")
    .eq("id", contentItemId)
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item) throw new Error("Content Factory job no longer belongs to the expected artist.");
  if (item.asset_url) return { item, reused: true as const };
  if (!item.release_id) throw new Error("Free composition requires content linked to a release.");

  const [releaseResult, trackResult] = await Promise.all([
    db.from("releases").select("id,title,artwork_url").eq("id", item.release_id).eq("owner_id", job.owner_id).single(),
    db.from("tracks").select("id,title,audio_url,display_order")
      .eq("release_id", item.release_id)
      .eq("owner_id", job.owner_id)
      .not("audio_url", "is", null)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (releaseResult.error || !releaseResult.data) throw new Error(releaseResult.error?.message || "Release not found.");
  if (trackResult.error) throw new Error(trackResult.error.message);
  if (!releaseResult.data.artwork_url) throw new Error("Free composition needs release artwork.");
  if (!trackResult.data?.audio_url) throw new Error("Free composition needs a release track with a public audio URL.");

  return {
    item,
    reused: false as const,
    release: releaseResult.data,
    track: trackResult.data,
  };
}

async function createRenderAttempt(job: ScopedAutomationJob) {
  const context = await loadRenderContext(job);
  if (context.reused) return { reused: true as const, assetUrl: context.item.asset_url };

  const marketing = createMarketingServiceClient();
  const db = createServiceClient();
  const template = templateFor(`${context.item.id}:${context.item.platform}:${context.item.format}`);
  const attempt = Math.max(1, job.attempt_count);
  const storagePath = `${job.owner_id}/generated/free-social/${context.item.id}/${job.id}-attempt-${attempt}.mp4`;
  const signed = await db.storage.from(BUCKET).createSignedUploadUrl(storagePath);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message || "Could not mint Content Factory upload credential.");
  }
  const publicUrl = db.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const callbackCredential = createMediaWorkerCallbackCredential();

  const { data: run, error: runError } = await marketing.from("generation_runs").insert({
    owner_id: job.owner_id,
    artist_id: job.artist_id,
    campaign_id: context.item.campaign_id,
    release_id: context.item.release_id,
    purpose: "content_asset:free_social_video",
    task_type: null,
    provider: "atlas-free-composer",
    model: template,
    requested_model: template,
    prompt_version: "media-worker-free-social-v2",
    input_context: asJson({
      automationJobId: job.id,
      contentItemId: context.item.id,
      artworkUrl: context.release.artwork_url,
      audioUrl: context.track.audio_url,
      startSeconds: Math.max(0, Number(context.item.audio_timestamp_start) || 0),
      durationSeconds: OUTPUT_SECONDS,
    }),
    output: asJson({ stage: "render_dispatched", publicUrl, storagePath }),
    status: "running",
    attempt_index: Math.max(0, attempt - 1),
    started_at: new Date().toISOString(),
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
    metadata: asJson({
      freeComposition: true,
      sharedMediaWorker: true,
      freeTierPolicy: { dailyLimit: DAILY_RENDER_LIMIT, monthlyLimit: MONTHLY_RENDER_LIMIT },
    }),
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message || "Could not record Content Factory execution.");

  const durablePayload = {
    ...clearRetryMetadata(record(job.payload)),
    content_item_id: context.item.id,
    artist_id: job.artist_id,
    release_id: context.item.release_id,
    generation_run_id: run.id,
    upload_bucket: BUCKET,
    upload_path: storagePath,
    public_url: publicUrl,
    template,
    [MEDIA_WORKER_CALLBACK_HASH_KEY]: callbackCredential.hash,
  };
  const { error: payloadError } = await marketing.from("automation_jobs").update({
    payload: asJson(durablePayload),
    error: null,
  }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  if (payloadError) throw new Error(payloadError.message);

  try {
    const dispatch = await dispatchMediaWorkerJob({
      jobId: job.id,
      jobType: "compose_free_social_asset",
      payload: {
        artwork_url: context.release.artwork_url,
        audio_url: context.track.audio_url,
        audio_start_ms: Math.max(0, Number(context.item.audio_timestamp_start) || 0) * 1000,
        upload_url: signed.data.signedUrl,
        public_url: publicUrl,
        template,
      },
      callbackUrl: `${getSiteUrl()}/api/cron/content-factory/callback`,
      callbackToken: callbackCredential.token,
    }, { entitlements: new Set() });
    return { reused: false as const, generationRunId: run.id, sandboxName: dispatch.sandboxName };
  } catch (error) {
    await marketing.from("generation_runs").update({
      status: "failed",
      error: error instanceof Error ? error.message : "Content Factory dispatch failed.",
      completed_at: new Date().toISOString(),
    }).eq("id", run.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
    throw error;
  }
}

export async function processFreeContentFactoryAutomationJob(job: ScopedAutomationJob) {
  if (job.job_type !== CONTENT_FACTORY_JOB_TYPE) {
    throw new Error(`Unexpected Content Factory job type: ${job.job_type}`);
  }
  return createRenderAttempt(job);
}

export async function dispatchFreeContentFactoryJob(jobId: string) {
  const marketing = createMarketingServiceClient();
  const now = new Date().toISOString();
  const { data: current, error: lookupError } = await marketing.from("automation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!current) return { dispatched: false, reason: "missing" as const };
  const typed = current as unknown as ScopedAutomationJob;
  if (typed.job_type !== CONTENT_FACTORY_JOB_TYPE) return { dispatched: false, reason: "wrong_type" as const };
  if (typed.status !== "queued") return { dispatched: false, reason: typed.status as "completed" | "failed" | "running" | "cancelled" | "awaiting_approval" };
  if (Date.parse(typed.run_after) > Date.now()) return { dispatched: false, reason: "backoff" as const, retryAt: typed.run_after };

  const { data: claimed, error: claimError } = await marketing.from("automation_jobs").update({
    status: "running",
    locked_at: now,
    attempt_count: typed.attempt_count + 1,
    completed_at: null,
  }).eq("id", typed.id)
    .eq("owner_id", typed.owner_id)
    .eq("artist_id", typed.artist_id)
    .eq("status", "queued")
    .lte("run_after", now)
    .select("*")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { dispatched: false, reason: "busy" as const };

  const job = claimed as unknown as ScopedAutomationJob;
  try {
    const result = await processFreeContentFactoryAutomationJob(job);
    const { error: completeError } = await marketing.from("automation_jobs").update({
      status: "completed",
      locked_at: null,
      completed_at: new Date().toISOString(),
      result: asJson({ outcome: result.reused ? "reused" : "dispatched", ...result }),
      error: null,
    }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id).eq("status", "running");
    if (completeError) throw new Error(completeError.message);
    return { dispatched: !result.reused, reason: result.reused ? "reused" as const : "started" as const, ...result };
  } catch (error) {
    const errorClass = classifyBackgroundFailure(error);
    const terminal = errorClass === "terminal" || job.attempt_count >= job.max_attempts;
    const nextRun = retryAt(errorClass, job.attempt_count) ?? new Date().toISOString();
    const { error: retryError } = await marketing.from("automation_jobs").update({
      status: terminal ? "failed" : "queued",
      locked_at: null,
      completed_at: terminal ? new Date().toISOString() : null,
      run_after: nextRun,
      payload: asJson(clearRetryMetadata(record(job.payload))),
      error: error instanceof Error ? error.message : "Content Factory dispatch failed.",
    }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
    if (retryError) throw new Error(retryError.message);
    return {
      dispatched: false,
      reason: terminal ? "failed" as const : "backoff" as const,
      errorClass,
      retryAt: terminal ? null : nextRun,
    };
  }
}

function callbackAuthorized(token: string, payload: Record<string, unknown>) {
  const expectedHash = payload[MEDIA_WORKER_CALLBACK_HASH_KEY];
  if (!token || typeof expectedHash !== "string" || expectedHash.length !== 64) return false;
  const actual = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function finalizeContentFactorySuccess(job: ScopedAutomationJob, result: Record<string, unknown>) {
  const marketing = createMarketingServiceClient();
  const db = createServiceClient();
  const payload = record(job.payload);
  const contentItemId = typeof payload.content_item_id === "string" ? payload.content_item_id : "";
  const generationRunId = typeof payload.generation_run_id === "string" ? payload.generation_run_id : "";
  const expectedUrl = typeof payload.public_url === "string" ? payload.public_url : "";
  const storagePath = typeof payload.upload_path === "string" ? payload.upload_path : "";
  const template = typeof payload.template === "string" ? payload.template : "minimal_frame";
  const resultUrl = typeof result.public_url === "string" ? result.public_url : "";
  if (!contentItemId || !generationRunId || !expectedUrl || !storagePath || resultUrl !== expectedUrl) {
    throw new Error("Content Factory callback does not match its durable render contract.");
  }

  const { data: run, error: runError } = await marketing.from("generation_runs")
    .select("id,status")
    .eq("id", generationRunId)
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .maybeSingle();
  if (runError || !run) throw new Error(runError?.message || "Content Factory generation run not found.");
  if (run.status === "completed") return { duplicate: true as const, generationRunId };

  const { data: item, error: itemError } = await marketing.from("content_items")
    .select("id,release_id,campaign_id")
    .eq("id", contentItemId)
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .maybeSingle();
  if (itemError || !item) throw new Error(itemError?.message || "Content Factory content item not found.");

  const { data: existing, error: existingError } = await db.from("media_assets")
    .select("id,public_url")
    .eq("owner_id", job.owner_id)
    .contains("metadata", { content_factory_automation_job_id: job.id })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let asset = existing;
  if (!asset) {
    const { data, error } = await db.from("media_assets").insert({
      owner_id: job.owner_id,
      bucket_name: BUCKET,
      storage_path: storagePath,
      public_url: expectedUrl,
      asset_type: "content_video",
      mime_type: typeof result.mime_type === "string" ? result.mime_type : "video/mp4",
      file_size: Number(result.file_size) || null,
      content_hash: typeof result.sha256 === "string" ? result.sha256 : null,
      width: Number(result.width) || 1080,
      height: Number(result.height) || 1920,
      duration_ms: Number(result.duration_ms) || OUTPUT_SECONDS * 1000,
      visibility: "public",
      metadata: asJson({
        title: "Ensemblis free social cut",
        upload_source: "ensemblis_free_content_factory",
        template,
        generation_run_id: generationRunId,
        artist_id: job.artist_id,
        content_factory_automation_job_id: job.id,
      }),
    }).select("id,public_url").single();
    if (error || !data) throw new Error(error?.message || "Could not register Content Factory media.");
    asset = data;
  }

  const { data: link, error: linkLookupError } = await db.from("media_links")
    .select("id")
    .eq("owner_id", job.owner_id)
    .eq("media_asset_id", asset.id)
    .eq("content_item_id", item.id)
    .eq("role", "content_video")
    .limit(1)
    .maybeSingle();
  if (linkLookupError) throw new Error(linkLookupError.message);
  if (!link) {
    const { error: linkError } = await db.from("media_links").insert({
      owner_id: job.owner_id,
      media_asset_id: asset.id,
      release_id: item.release_id,
      content_item_id: item.id,
      role: "content_video",
      display_order: 0,
      is_primary: true,
    });
    if (linkError) throw new Error(linkError.message);
  }

  const { error: runCompleteError } = await marketing.from("generation_runs").update({
    status: "completed",
    output: asJson({
      stage: "completed",
      assetUrl: expectedUrl,
      mediaAssetId: asset.id,
      template,
      contentHash: typeof result.sha256 === "string" ? result.sha256 : null,
    }),
    error: null,
    completed_at: new Date().toISOString(),
    actual_cost_usd: 0,
    quality_gate_passed: true,
    quality_score: 1,
    quality_failures: [],
  }).eq("id", generationRunId).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  if (runCompleteError) throw new Error(runCompleteError.message);

  const { error: contentError } = await marketing.from("content_items").update({
    asset_url: expectedUrl,
    generated_from_run_id: generationRunId,
  }).eq("id", item.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  if (contentError) throw new Error(contentError.message);

  await marketing.from("marketing_events").insert({
    owner_id: job.owner_id,
    artist_id: job.artist_id,
    campaign_id: item.campaign_id,
    event_type: "content.free_asset_ready",
    entity_type: "content_item",
    entity_id: item.id,
    payload: asJson({ mediaAssetId: asset.id, generationRunId, template, costUsd: 0 }),
  });
  return { duplicate: false as const, generationRunId, mediaAssetId: asset.id, assetUrl: expectedUrl };
}

export async function handleFreeContentFactoryCallback(input: {
  jobId: string;
  status: "running" | "completed" | "failed";
  result: Record<string, unknown>;
  error: string | null;
  token: string;
}) {
  const marketing = createMarketingServiceClient();
  const { data, error } = await marketing.from("automation_jobs").select("*").eq("id", input.jobId).maybeSingle();
  if (error || !data) throw new Error(error?.message || "Content Factory job not found.");
  const job = data as unknown as ScopedAutomationJob;
  const payload = record(job.payload);
  if (!callbackAuthorized(input.token, payload)) throw new Error("Unauthorized Content Factory callback.");
  const generationRunId = typeof payload.generation_run_id === "string" ? payload.generation_run_id : "";
  if (!generationRunId) throw new Error("Content Factory callback has no generation lineage.");

  if (input.status === "running") {
    await marketing.from("generation_runs").update({
      status: "running",
      error: null,
      started_at: new Date().toISOString(),
    }).eq("id", generationRunId).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
    return { ok: true as const, running: true as const };
  }

  if (input.status === "completed") {
    const finalized = await finalizeContentFactorySuccess(job, input.result);
    return { ok: true as const, ...finalized };
  }

  const { data: run } = await marketing.from("generation_runs")
    .select("status")
    .eq("id", generationRunId)
    .eq("owner_id", job.owner_id)
    .eq("artist_id", job.artist_id)
    .maybeSingle();
  if (run?.status === "failed" && ["queued", "failed"].includes(job.status)) {
    return { ok: true as const, duplicate: true as const };
  }

  const message = input.error || "Content Factory worker failed.";
  const errorClass = classifyBackgroundFailure(message);
  const terminal = errorClass === "terminal" || job.attempt_count >= job.max_attempts;
  const nextRun = retryAt(errorClass, Math.max(1, job.attempt_count)) ?? new Date().toISOString();
  await marketing.from("generation_runs").update({
    status: "failed",
    error: message,
    completed_at: new Date().toISOString(),
  }).eq("id", generationRunId).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);

  const { error: retryError } = await marketing.from("automation_jobs").update({
    status: terminal ? "failed" : "queued",
    locked_at: null,
    completed_at: terminal ? new Date().toISOString() : null,
    run_after: nextRun,
    payload: asJson(clearRetryMetadata(payload)),
    error: message,
  }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  if (retryError) throw new Error(retryError.message);
  return { ok: true as const, retrying: !terminal, retryAt: terminal ? null : nextRun, errorClass };
}

export function freeContentFactoryReadiness() {
  return {
    ...mediaWorkerReadiness(),
    jobType: CONTENT_FACTORY_JOB_TYPE,
    snapshotExpirationMs: SANDBOX_SNAPSHOT_EXPIRATION_MS,
  };
}
