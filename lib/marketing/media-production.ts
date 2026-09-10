import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { asMomentAwareMarketingClient, asMomentsClient } from "@/lib/studio/moments-db";
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

type AudioWindow = {
  startSeconds: number | null;
  endSeconds: number | null;
  source: "explicit" | "approved_moment" | "legacy_content";
  momentId: string | null;
};

function clampedDurationMs(
  request: CreativeGenerationRequest | null,
  treatment: CreativeTreatment,
  audioWindow: AudioWindow,
) {
  const packageMin = treatment.platformPackage.minDurationSeconds ?? 4;
  const packageMax = treatment.platformPackage.maxDurationSeconds ?? 60;
  const exactMomentDuration = audioWindow.source === "approved_moment" &&
    typeof audioWindow.startSeconds === "number" &&
    typeof audioWindow.endSeconds === "number" &&
    audioWindow.endSeconds > audioWindow.startSeconds
    ? audioWindow.endSeconds - audioWindow.startSeconds
    : null;
  const shotEnd = treatment.shotPlan.reduce((max, shot) => Math.max(max, shot.endSeconds), 0);
  // The final social master follows the reviewed musical Moment, not the provider clip length.
  // The worker can loop/reframe a shorter generated plate while the complete audio phrase resolves.
  const requested = exactMomentDuration ?? (shotEnd > 0 ? shotEnd : request?.durationSeconds ?? 12);
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
  audioWindow: AudioWindow;
}) {
  const scene = input.context.selectedAudioScene;
  const windowStartMs = typeof input.audioWindow.startSeconds === "number"
    ? Math.round(input.audioWindow.startSeconds * 1000)
    : null;
  const windowEndMs = typeof input.audioWindow.endSeconds === "number"
    ? Math.round(input.audioWindow.endSeconds * 1000)
    : null;

  if (input.audioWindow.source === "approved_moment") {
    if (windowStartMs === null || windowEndMs === null || windowEndMs <= windowStartMs) {
      throw new Error("Approved Moment finishing requires a valid exact audio window.");
    }
    if (scene?.previewUrl) {
      const sceneCoversMoment = typeof scene.startMs === "number" && typeof scene.endMs === "number" &&
        scene.startMs <= windowStartMs && scene.endMs >= windowEndMs;
      if (sceneCoversMoment) {
        return {
          url: scene.previewUrl,
          startMs: windowStartMs - scene.startMs!,
          source: "audio_scene" as const,
          sceneId: scene.id,
        };
      }
      // A semantically attractive Audio Scene must never override the reviewed Moment boundaries.
      // Use a distinct canonical master reference if one is available; otherwise fail closed.
      if (input.context.audioReferenceUrl && input.context.audioReferenceUrl !== scene.previewUrl) {
        return {
          url: input.context.audioReferenceUrl,
          startMs: windowStartMs,
          source: "canonical_master" as const,
          sceneId: null,
        };
      }
      throw new Error("Selected Audio Scene does not cover the approved musical Moment. Choose a compatible scene or use the canonical master before finishing.");
    }
    if (input.context.audioReferenceUrl) {
      return {
        url: input.context.audioReferenceUrl,
        startMs: windowStartMs,
        source: "canonical_master" as const,
        sceneId: null,
      };
    }
    throw new Error("Approved Moment finishing requires a portable Audio Scene or canonical master audio.");
  }

  if (scene?.previewUrl) {
    return { url: scene.previewUrl, startMs: 0, source: "audio_scene" as const, sceneId: scene.id };
  }
  if (input.context.audioReferenceUrl) {
    const startSeconds = input.audioWindow.startSeconds;
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

async function resolveAudioWindow(input: {
  service: ReturnType<typeof createServiceClient>;
  ownerId: string;
  artistId: string;
  contentItemId: string;
  supplied?: { startSeconds: number | null; endSeconds: number | null } | null;
}): Promise<AudioWindow> {
  if (input.supplied) {
    return { ...input.supplied, source: "explicit", momentId: null };
  }
  const contentClient = asMomentAwareMarketingClient(input.service);
  const { data: content, error: contentError } = await contentClient.from("content_items")
    .select("audio_timestamp_start,audio_timestamp_end,moment_id")
    .eq("id", input.contentItemId)
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .maybeSingle();
  if (contentError) throw new Error(contentError.message);
  if (!content) throw new Error("Video finishing content does not belong to the expected artist.");

  if (content.moment_id) {
    const momentClient = asMomentsClient(input.service);
    const { data: moment, error: momentError } = await momentClient.from("moments")
      .select("id,start_ms,end_ms,state,artist_id,owner_id")
      .eq("id", content.moment_id)
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .maybeSingle();
    if (momentError) throw new Error(momentError.message);
    if (!moment) throw new Error("Content points to a missing musical Moment.");
    if (moment.state !== "approved") throw new Error("Video finishing requires an approved musical Moment.");
    if (moment.end_ms <= moment.start_ms) throw new Error("Approved musical Moment has invalid boundaries.");
    return {
      startSeconds: moment.start_ms / 1000,
      endSeconds: moment.end_ms / 1000,
      source: "approved_moment",
      momentId: moment.id,
    };
  }

  return {
    startSeconds: content.audio_timestamp_start,
    endSeconds: content.audio_timestamp_end,
    source: "legacy_content",
    momentId: null,
  };
}

export async function enqueueMarketingVideoFinishing(input: {
  ownerId: string;
  artistId: string;
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
  if (input.context.artistId !== input.artistId) {
    throw new Error("Video finishing context does not match its artist lineage.");
  }
  const marketing = client();
  const service = createServiceClient();
  const audioWindow = await resolveAudioWindow({
    service,
    ownerId: input.ownerId,
    artistId: input.artistId,
    contentItemId: input.contentItemId,
    supplied: input.audioWindow,
  });
  const durationMs = clampedDurationMs(input.request, input.treatment, audioWindow);
  const bucket = "public-media";
  const outputPath = `${input.ownerId}/library/marketing/${input.artistId}/finished/${input.generationRunId}.mp4`;
  const outputPublicUrl = service.storage.from(bucket).getPublicUrl(outputPath).data.publicUrl;
  const frameUploads = reviewFrameTimestamps(durationMs).map((timestampMs, index) => {
    const path = `${input.ownerId}/library/marketing/${input.artistId}/qc/${input.generationRunId}/frame-${String(index + 1).padStart(2, "0")}.jpg`;
    return {
      index: index + 1,
      timestamp_ms: timestampMs,
      upload_bucket: bucket,
      upload_path: path,
      public_url: service.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    };
  });

  const audio = audioPlan({ context: input.context, audioWindow });
  const payload = {
    artist_id: input.artistId,
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
    audio_window_source: audioWindow.source,
    moment_id: audioWindow.momentId,
    moment_start_ms: audioWindow.source === "approved_moment" && audioWindow.startSeconds !== null ? Math.round(audioWindow.startSeconds * 1000) : null,
    moment_end_ms: audioWindow.source === "approved_moment" && audioWindow.endSeconds !== null ? Math.round(audioWindow.endSeconds * 1000) : null,
    safe_area: input.treatment.platformPackage.safeArea,
    overlay_text: deterministicOverlay(input.treatment),
    typography_direction: input.treatment.typographyDirection,
    finishing_notes: input.treatment.finishingNotes,
    platform_package_id: input.treatment.platformPackage.id,
    review_frames: frameUploads,
  };
  const idempotencyKey = `finish-social-video:${input.generationRunId}:v3`;

  const { data: created, error } = await marketing.from("marketing_media_jobs").insert({
    owner_id: input.ownerId,
    artist_id: input.artistId,
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
      .eq("artist_id", input.artistId)
      .eq("idempotency_key", idempotencyKey)
      .single();
    if (existing.error || !existing.data) throw new Error(existing.error?.message || "Could not recover existing marketing media job.");
    job = existing.data;
  }
  if (!job) throw new Error("Marketing video finishing job could not be created.");

  const { data: run, error: runError } = await marketing.from("generation_runs")
    .select("output")
    .eq("id", input.generationRunId)
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) throw new Error("Generation run does not belong to the video finishing artist.");
  const currentOutput = run.output && typeof run.output === "object" && !Array.isArray(run.output)
    ? run.output as Record<string, unknown>
    : {};
  const { error: runUpdateError } = await marketing.from("generation_runs").update({
    output: json({
      ...currentOutput,
      stage: "finishing_queued",
      finishingJobId: job.id,
      rawResultUrl: input.rawAssetUrl,
      rawMediaAssetId: input.rawAssetId,
      audioWindowSource: audioWindow.source,
      momentId: audioWindow.momentId,
      approvalRequired: false,
    }),
  }).eq("id", input.generationRunId).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
  if (runUpdateError) throw new Error(runUpdateError.message);

  try {
    const { kickMarketingMediaWorkerQueue } = await import("@/lib/marketing/media-worker-queue");
    await kickMarketingMediaWorkerQueue({ ownerId: input.ownerId, artistId: input.artistId });
  } catch {
    // The job is durable. A terminal Media Worker callback will give this queue another chance.
  }
  return job;
}
