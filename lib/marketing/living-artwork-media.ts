import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMarketingServiceClient } from "./db";
import { kickMarketingMediaWorkerQueue } from "./media-worker-queue";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { MarketingMediaDatabase, MarketingMediaJob } from "@/types/marketing-media-database";
import { LIVING_ARTWORK_TARGET } from "./living-artwork";

function client() {
  return createMarketingServiceClient() as unknown as SupabaseClient<MarketingMediaDatabase>;
}

function json(value: unknown) {
  return value as Json;
}

function stableKey(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

async function existingJob(db: ReturnType<typeof client>, artistId: string, idempotencyKey: string) {
  const { data, error } = await db.from("marketing_media_jobs")
    .select("*")
    .eq("artist_id", artistId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as MarketingMediaJob | null;
}

export async function enqueueLivingArtworkNormalization(input: {
  ownerId: string;
  artistId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  generationRunId?: string | null;
  rawAssetId: string;
  rawAssetUrl: string;
  repairPolicy?: "none" | "auto";
}) {
  const db = client();
  const repairPolicy = input.repairPolicy ?? "none";
  const idempotencyKey = `living-artwork:normalize:${input.rawAssetId}:${repairPolicy}`;
  const existing = await existingJob(db, input.artistId, idempotencyKey);
  if (existing) {
    if (["planned", "queued", "running"].includes(existing.status)) {
      await kickMarketingMediaWorkerQueue({ ownerId: input.ownerId, artistId: input.artistId });
    }
    return existing;
  }

  const service = createServiceClient();
  const jobId = randomUUID();
  const bucket = "public-media";
  const outputPath = `${input.ownerId}/library/marketing/${input.artistId}/living-artwork/${input.contentItemId}/loops/${jobId}.mp4`;
  const publicUrl = service.storage.from(bucket).getPublicUrl(outputPath).data.publicUrl;

  const { data, error } = await db.from("marketing_media_jobs").insert({
    id: jobId,
    owner_id: input.ownerId,
    artist_id: input.artistId,
    campaign_id: input.campaignId,
    release_id: input.releaseId,
    content_item_id: input.contentItemId,
    generation_run_id: input.generationRunId ?? null,
    job_type: "normalize_loop_video",
    status: "planned",
    idempotency_key: idempotencyKey,
    request_payload: json({
      artist_id: input.artistId,
      source_url: input.rawAssetUrl,
      source_asset_id: input.rawAssetId,
      upload_bucket: bucket,
      upload_path: outputPath,
      public_url: publicUrl,
      width: LIVING_ARTWORK_TARGET.width,
      height: LIVING_ARTWORK_TARGET.height,
      fps: LIVING_ARTWORK_TARGET.fps,
      repair_policy: repairPolicy,
    }),
    result_payload: json({}),
    attempt_count: 0,
    max_attempts: 3,
  }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not queue loop normalization.");

  await kickMarketingMediaWorkerQueue({ ownerId: input.ownerId, artistId: input.artistId });
  return data as MarketingMediaJob;
}

export async function enqueueLivingArtworkVisualizer(input: {
  ownerId: string;
  artistId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  loopAssetId: string;
  loopAssetUrl: string;
  audioUrl: string;
  durationMs: number;
}) {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 1_000 || input.durationMs > 20 * 60 * 1000) {
    throw new Error("Full-track visualizer requires a valid music duration up to 20 minutes.");
  }
  const fingerprint = stableKey(`${input.loopAssetId}|${input.audioUrl}|${input.durationMs}`);
  const idempotencyKey = `living-artwork:full-track:${input.contentItemId}:${fingerprint}`;
  const db = client();
  const existing = await existingJob(db, input.artistId, idempotencyKey);
  if (existing) {
    if (["planned", "queued", "running"].includes(existing.status)) {
      await kickMarketingMediaWorkerQueue({ ownerId: input.ownerId, artistId: input.artistId });
    }
    return existing;
  }

  const service = createServiceClient();
  const jobId = randomUUID();
  const bucket = "public-media";
  const outputPath = `${input.ownerId}/library/marketing/${input.artistId}/living-artwork/${input.contentItemId}/exports/full-track-${jobId}.mp4`;
  const publicUrl = service.storage.from(bucket).getPublicUrl(outputPath).data.publicUrl;

  const { data, error } = await db.from("marketing_media_jobs").insert({
    id: jobId,
    owner_id: input.ownerId,
    artist_id: input.artistId,
    campaign_id: input.campaignId,
    release_id: input.releaseId,
    content_item_id: input.contentItemId,
    generation_run_id: null,
    job_type: "render_loop_visualizer",
    status: "planned",
    idempotency_key: idempotencyKey,
    request_payload: json({
      artist_id: input.artistId,
      source_url: input.loopAssetUrl,
      source_asset_id: input.loopAssetId,
      audio_url: input.audioUrl,
      duration_ms: Math.round(input.durationMs),
      upload_bucket: bucket,
      upload_path: outputPath,
      public_url: publicUrl,
      width: LIVING_ARTWORK_TARGET.width,
      height: LIVING_ARTWORK_TARGET.height,
      fps: LIVING_ARTWORK_TARGET.fps,
      duration_mode: "full_audio",
    }),
    result_payload: json({}),
    attempt_count: 0,
    max_attempts: 3,
  }).select("*").single();
  if (error || !data) throw new Error(error?.message || "Could not queue full-track visualizer.");

  await kickMarketingMediaWorkerQueue({ ownerId: input.ownerId, artistId: input.artistId });
  return data as MarketingMediaJob;
}
