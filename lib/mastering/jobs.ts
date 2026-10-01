import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  isMediaWorkerBusyError,
  isMediaWorkerCapacityError,
  mediaWorkerCapacityBlocked,
  mediaWorkerCapacityErrorMessage,
  mediaWorkerCapacityRetryAfter,
} from "@/lib/media-worker/failures";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
} from "@/lib/media-worker/sandbox";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import type { MasteringDatabase, TrackMasteringJob } from "@/types/mastering-database";

const MASTERING_BUCKET = "public-media";
const MASTERING_CHUNK_SLOT_COUNT = 14;
const MASTERING_CODEC_PREVIEWS = [
  { id: "aac_256", suffix: "aac-256.m4a", mimeType: "audio/mp4" },
  { id: "opus_160", suffix: "opus-160.ogg", mimeType: "audio/ogg" },
] as const;

export function asMasteringClient(client: SupabaseClient<Database> | SupabaseClient<MasteringDatabase>) {
  return client as unknown as SupabaseClient<MasteringDatabase>;
}

function json(value: unknown): Json {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function withoutCredential(value: Record<string, unknown>) {
  const next = { ...value };
  delete next[MEDIA_WORKER_CALLBACK_HASH_KEY];
  delete next.upload_url;
  delete next.chunk_uploads;
  delete next.codec_preview_uploads;
  return next;
}

export function masteringChunkPaths(path: string, count = MASTERING_CHUNK_SLOT_COUNT) {
  const base = path.toLowerCase().endsWith(".flac") ? path.slice(0, -5) : path;
  return Array.from(
    { length: count },
    (_, index) => `${base}/chunks/part-${String(index).padStart(3, "0")}.bin`,
  );
}

export function masteringOutputPath(job: Pick<TrackMasteringJob, "owner_id" | "artist_id" | "track_vault_id" | "id">) {
  return `mastering/${job.owner_id}/${job.artist_id}/${job.track_vault_id}/${job.id}.flac`;
}

export function masteringCodecPreviewPaths(path: string) {
  const base = path.toLowerCase().endsWith(".flac") ? path.slice(0, -5) : path;
  return MASTERING_CODEC_PREVIEWS.map((preview) => ({
    ...preview,
    storagePath: `${base}/previews/${preview.suffix}`,
  }));
}

export async function kickMasteringQueue() {
  const service = createServiceClient();
  const db = asMasteringClient(service);
  const active = await db.from("track_mastering_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (active.error) throw new Error(active.error.message);
  if (active.data) return { dispatched: false, busy: true };

  const planned = await db.from("track_mastering_jobs")
    .select("*")
    .eq("status", "planned")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (planned.error) throw new Error(planned.error.message);
  if (!planned.data) return { dispatched: false, busy: false };
  const job = planned.data as TrackMasteringJob;
  const capacity = mediaWorkerCapacityBlocked(job.error);
  if (capacity.blocked) {
    return { dispatched: false, busy: false, reason: "capacity" as const, retryAt: capacity.retryAfter };
  }
  const path = job.output_path || masteringOutputPath(job);
  const credential = createMediaWorkerCallbackCredential();
  const basePayload = withoutCredential(record(job.request_payload));

  const bucket = job.output_bucket || MASTERING_BUCKET;
  const upload = await service.storage.from(bucket).createSignedUploadUrl(path);
  if (upload.error || !upload.data?.signedUrl) {
    throw new Error(upload.error?.message || "Could not create Active Mastering upload URL.");
  }

  const chunkPaths = masteringChunkPaths(path);
  const chunkSlots = await Promise.all(chunkPaths.map(async (storagePath) => {
    const signed = await service.storage.from(bucket).createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message || "Could not create Active Mastering chunk upload URL.");
    }
    return {
      storage_path: storagePath,
      upload_url: signed.data.signedUrl,
    };
  }));

  const codecPreviewSlots = await Promise.all(masteringCodecPreviewPaths(path).map(async (preview) => {
    const signed = await service.storage.from(bucket).createSignedUploadUrl(preview.storagePath);
    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message || "Could not create mastering codec-preview upload URL.");
    }
    return {
      id: preview.id,
      mime_type: preview.mimeType,
      storage_path: preview.storagePath,
      upload_url: signed.data.signedUrl,
      public_url: service.storage.from(bucket).getPublicUrl(preview.storagePath).data.publicUrl,
    };
  }));

  const directPublicUrl = service.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const chunkedPublicUrl = `${getSiteUrl()}/api/media/mastering/${job.id}`;
  const requestPayload = {
    ...basePayload,
    upload_url: upload.data.signedUrl,
    chunk_uploads: chunkSlots,
    codec_preview_uploads: codecPreviewSlots,
    upload_bucket: bucket,
    upload_path: path,
    public_url: directPublicUrl,
    direct_public_url: directPublicUrl,
    chunked_public_url: chunkedPublicUrl,
    [MEDIA_WORKER_CALLBACK_HASH_KEY]: credential.hash,
  };

  const claimed = await db.from("track_mastering_jobs").update({
    status: "queued",
    request_payload: json(requestPayload),
    output_path: path,
    error: null,
    external_job_id: null,
    started_at: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", "planned").select("*").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { dispatched: false, busy: false };

  try {
    const dispatch = await dispatchMediaWorkerJob({
      jobId: job.id,
      jobType: "master_audio",
      payload: requestPayload,
      callbackUrl: `${getSiteUrl()}/api/studio/mastering/callback`,
      callbackToken: credential.token,
    });
    const update = await db.from("track_mastering_jobs").update({
      external_job_id: dispatch.sandboxName,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    if (update.error) throw new Error(update.error.message);
    return { dispatched: true, busy: false };
  } catch (error) {
    if (isMediaWorkerCapacityError(error)) {
      const message = mediaWorkerCapacityErrorMessage(error);
      await db.from("track_mastering_jobs").update({
        status: "planned",
        request_payload: json(basePayload),
        external_job_id: null,
        error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return {
        dispatched: false,
        busy: false,
        reason: "capacity" as const,
        retryAt: mediaWorkerCapacityRetryAfter(message),
      };
    }
    if (isMediaWorkerBusyError(error)) {
      await db.from("track_mastering_jobs").update({
        status: "planned",
        request_payload: json(basePayload),
        external_job_id: null,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { dispatched: false, busy: true, reason: "busy" as const };
    }
    const message = error instanceof Error ? error.message : "Active Mastering dispatch failed.";
    await db.from("track_mastering_jobs").update({
      status: "failed",
      request_payload: json(basePayload),
      error: message,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw new Error(message);
  }
}
