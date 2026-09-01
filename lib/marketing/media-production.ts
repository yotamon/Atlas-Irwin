import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { createMarketingServiceClient } from "./db";
import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeTreatment } from "./creative-treatment";
import type { CreativeGenerationRequest } from "./creative-provider-types";
import type { Json } from "@/types/database";
import type { MarketingMediaDatabase, MarketingMediaJob } from "@/types/marketing-media-database";

function client() {
  return createMarketingServiceClient() as unknown as SupabaseClient<MarketingMediaDatabase>;
}

function json(value: unknown) {
  return value as Json;
}

function clampedDurationMs(request: CreativeGenerationRequest | null, treatment: CreativeTreatment) {
  const packageMin = treatment.platformPackage.minDurationSeconds ?? 4;
  const packageMax = treatment.platformPackage.maxDurationSeconds ?? 60;
  const shotEnd = treatment.shotPlan.reduce((max, shot) => Math.max(max, shot.endSeconds), 0);
  const requested = request?.durationSeconds ?? (shotEnd > 0 ? shotEnd : 12);
  return Math.round(Math.max(packageMin, Math.min(packageMax, requested)) * 1000);
}

function reviewFrameTimestamps(durationMs: number) {
  const ratios = [0.04, 0.22, 0.5, 0.76, 0.96];
  return Array.from(new Set(ratios.map((ratio) => Math.max(0, Math.min(durationMs - 80, Math.round(durationMs * ratio))))));
}

function deterministicOverlay(treatment: CreativeTreatment) {
  const text = treatment.shotPlan
    .map((shot) => shot.onScreenText.trim())
    .find((candidate) => candidate.length > 0);
  if (!text) return null;
  return text.slice(0, 120);
}

function audioPlan(input: {
  context: CreativeReferenceContext;
  audioWindow?: { startSeconds: number | null; endSeconds: number | null } | null;
}) {
  const scene = input.context.selectedAudioScene;
  if (scene?.previewUrl) {
    return { url: scene.previewUrl, startMs: 0, source: "audio_scene" as const, sceneId: scene.id };
  }
  if (input.context.audioReferenceUrl) {
    const startSeconds = input.audioWindow?.startSeconds;
    const sceneStart = scene?.startMs;
    const startMs = typeof startSeconds === "number" && startSeconds >= 0
      ? Math.round(startSeconds * 1000)
      : typeof sceneStart === "number" && sceneStart >= 0
        ? sceneStart
        : 0;
    return { url: input.context.audioReferenceUrl, startMs, source: "canonical_master" as const, sceneId: scene?.id ?? null };
  }
  return { url: null, startMs: 0, source: "none" as const, sceneId: scene?.id ?? null };
}

export async function enqueueMarketingVideoFinishing(input: {
  ownerId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  generationRunId: string;
  rawAssetId: string;
  rawAssetUrl: string;
  treatment: CreativeTreatment;
  context: CreativeReferenceContext;
  request: CreativeGenerationRequest | null;
  audioWindow?: { startSeconds: number | null; endSeconds: number | null } | null;
}): Promise<MarketingMediaJob> {
  const marketing = client();
  const service = createServiceClient();
  const durationMs = clampedDurationMs(input.request, input.treatment);
  const bucket = "public-media";
  const outputPath = `${input.ownerId}/library/marketing/finished/${input.generationRunId}.mp4`;
  const outputPublicUrl = service.storage.from(bucket).getPublicUrl(outputPath).data.publicUrl;
  const frameUploads = reviewFrameTimestamps(durationMs).map((timestampMs, index) => {
    const path = `${input.ownerId}/library/marketing/qc/${input.generationRunId}/frame-${String(index + 1).padStart(2, "0")}.jpg`;
    return {
      index: index + 1,
      timestamp_ms: timestampMs,
      upload_bucket: bucket,
      upload_path: path,
      public_url: service.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    };
  });

  let audioWindow = input.audioWindow;
  if (!audioWindow) {
    const { data: content, error: contentError } = await marketing.from("content_items")
      .select("audio_timestamp_start,audio_timestamp_end")
      .eq("id", input.contentItemId)
      .eq("owner_id", input.ownerId)
      .maybeSingle();
    if (contentError) throw new Error(contentError.message);
    audioWindow = content
      ? { startSeconds: content.audio_timestamp_start, endSeconds: content.audio_timestamp_end }
      : null;
  }
  const audio = audioPlan({ context: input.context, audioWindow });
  const payload = {
    source_url: input.rawAssetUrl,
    source_asset_id: input.rawAssetId,
    upload_bucket: bucket,
    upload_path: outputPath,
    public_url: outputPublicUrl,
    width: input.treatment.platformPackage.width,
    height: input.treatment.platformPackage.height,
    fps: 30,
    duration_ms: durationMs,
    audio_url: audio.url,
    audio_start_ms: audio.startMs,
    audio_source: audio.source,
    audio_scene_id: audio.sceneId,
    safe_area: input.treatment.platformPackage.safeArea,
    overlay_text: deterministicOverlay(input.treatment),
    typography_direction: input.treatment.typographyDirection,
    finishing_notes: input.treatment.finishingNotes,
    platform_package_id: input.treatment.platformPackage.id,
    review_frames: frameUploads,
  };
  const idempotencyKey = `finish-social-video:${input.generationRunId}:v1`;

  const { data: created, error } = await marketing.from("marketing_media_jobs").insert({
    owner_id: input.ownerId,
    campaign_id: input.campaignId,
    release_id: input.releaseId,
    content_item_id: input.contentItemId,
    generation_run_id: input.generationRunId,
    job_type: "finish_social_video",
    status: "planned",
    idempotency_key: idempotencyKey,
    request_payload: json(payload),
    result_payload: json({}),
  }).select("*").maybeSingle();

  let job = created;
  if (error) {
    if (error.code !== "23505") throw new Error(error.message);
    const existing = await marketing.from("marketing_media_jobs")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("idempotency_key", idempotencyKey)
      .single();
    if (existing.error || !existing.data) throw new Error(existing.error?.message || "Could not recover existing marketing media job.");
    job = existing.data;
  }
  if (!job) throw new Error("Marketing video finishing job could not be created.");

  const { data: run } = await marketing.from("generation_runs").select("output").eq("id", input.generationRunId).maybeSingle();
  const currentOutput = run?.output && typeof run.output === "object" && !Array.isArray(run.output)
    ? run.output as Record<string, unknown>
    : {};
  await marketing.from("generation_runs").update({
    output: json({
      ...currentOutput,
      stage: "finishing_queued",
      finishingJobId: job.id,
      rawResultUrl: input.rawAssetUrl,
      rawMediaAssetId: input.rawAssetId,
      approvalRequired: false,
    }),
  }).eq("id", input.generationRunId);

  try {
    const { kickMarketingMediaWorkerQueue } = await import("@/lib/marketing/media-worker-queue");
    await kickMarketingMediaWorkerQueue();
  } catch {
    // The job is durable. A terminal Media Worker callback will give this queue another chance.
  }
  return job;
}
