import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchMediaWorkerJob } from "@/lib/media-worker/dispatcher";
import {
  createMediaWorkerCallbackCredential,
  MEDIA_WORKER_CALLBACK_HASH_KEY,
} from "@/lib/media-worker/sandbox";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import type { MasteringDatabase, TrackMasteringJob } from "@/types/mastering-database";

const MASTERING_BUCKET = "public-media";

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
  return next;
}

function busyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /already processing|worker is busy/i.test(message);
}

export function masteringOutputPath(job: Pick<TrackMasteringJob, "owner_id" | "artist_id" | "track_vault_id" | "id">) {
  return `mastering/${job.owner_id}/${job.artist_id}/${job.track_vault_id}/${job.id}.wav`;
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
  const path = job.output_path || masteringOutputPath(job);
  const credential = createMediaWorkerCallbackCredential();
  const basePayload = withoutCredential(record(job.request_payload));

  const upload = await service.storage.from(job.output_bucket || MASTERING_BUCKET).createSignedUploadUrl(path);
  if (upload.error || !upload.data?.signedUrl) {
    throw new Error(upload.error?.message || "Could not create Active Mastering upload URL.");
  }
  const publicUrl = service.storage.from(job.output_bucket || MASTERING_BUCKET).getPublicUrl(path).data.publicUrl;
  const requestPayload = {
    ...basePayload,
    upload_url: upload.data.signedUrl,
    upload_bucket: job.output_bucket || MASTERING_BUCKET,
    upload_path: path,
    public_url: publicUrl,
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
    if (busyError(error)) {
      await db.from("track_mastering_jobs").update({
        status: "planned",
        request_payload: json(basePayload),
        external_job_id: null,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      return { dispatched: false, busy: true };
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
