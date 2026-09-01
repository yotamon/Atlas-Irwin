import "server-only";

import { createMarketingServiceClient } from "@/lib/marketing/db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeProviderStatus } from "./creative-provider-types";
import type { CreativeTreatment } from "./creative-treatment";
import { reviewGeneratedCreativeImage } from "./creative-visual-quality";
import { storeRemoteMarketingAsset } from "./generated-assets";

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function json(value: unknown) {
  return value as Json;
}

export async function applyMarketingCreativeProviderStatus(input: {
  runId?: string;
  providerRequestId?: string;
  status: CreativeProviderStatus;
}) {
  const marketing = createMarketingServiceClient();
  let query = marketing.from("generation_runs").select("*");
  if (input.runId) query = query.eq("id", input.runId);
  else if (input.providerRequestId) query = query.eq("provider_request_id", input.providerRequestId);
  else throw new Error("A generation run id or provider request id is required.");
  const { data: run, error: runError } = await query.limit(1).maybeSingle();
  if (runError) throw new Error(runError.message);
  if (!run) return { ignored: true as const, reason: "unknown_generation" };
  if (!run.purpose.startsWith("content_asset:")) return { ignored: true as const, reason: "not_marketing_creative" };
  if (run.status === "completed") return { completed: true as const, duplicate: true as const, output: run.output };

  const inputContext = record(run.input_context);
  const output = record(run.output);
  const providerRequestId = input.status.requestId || run.provider_request_id;
  if (input.status.status === "queued" || input.status.status === "in_progress") {
    const { error } = await marketing.from("generation_runs").update({
      status: "running",
      provider_request_id: providerRequestId,
      output: json({ ...output, stage: "generating", providerStatus: input.status.status, providerRaw: input.status.raw }),
      error: null,
    }).eq("id", run.id);
    if (error) throw new Error(error.message);
    return { completed: false as const, status: input.status.status };
  }

  if (input.status.status === "failed" || input.status.status === "nsfw") {
    const message = input.status.status === "nsfw"
      ? `${run.provider} rejected this generation during safety review.`
      : `${run.provider} reported that the creative generation failed.`;
    const { error } = await marketing.from("generation_runs").update({
      status: "failed",
      provider_request_id: providerRequestId,
      output: json({ ...output, stage: "failed", providerStatus: input.status.status, providerRaw: input.status.raw }),
      error: message,
    }).eq("id", run.id);
    if (error) throw new Error(error.message);
    return { completed: false as const, status: input.status.status };
  }

  if (!input.status.resultUrl && !input.status.resultBase64) throw new Error(`${run.provider} reported completion without a media result.`);
  const contentItemId = stringValue(inputContext.contentItemId);
  const outputKind = stringValue(inputContext.outputKind);
  const assetType = stringValue(inputContext.assetType);
  const storedContext = inputContext.referenceContext;
  const storedTreatment = inputContext.treatment;
  if (!contentItemId || !["image", "video"].includes(outputKind) || !["social_image", "content_video"].includes(assetType)) {
    throw new Error("Stored marketing generation context is incomplete.");
  }
  if (!storedContext || typeof storedContext !== "object" || Array.isArray(storedContext)) {
    throw new Error("Stored creative reference context is missing.");
  }
  if (!storedTreatment || typeof storedTreatment !== "object" || Array.isArray(storedTreatment)) {
    throw new Error("Stored Creative Director treatment is missing.");
  }

  const actualCostUsd = input.status.actualCostUsd ?? run.estimated_cost_usd ?? null;
  const db = createServiceClient();
  const stored = await storeRemoteMarketingAsset({
    db,
    ownerId: run.owner_id,
    generationRunId: run.id,
    campaignId: run.campaign_id,
    releaseId: run.release_id,
    contentItemId,
    provider: run.provider,
    model: run.model,
    remoteUrl: input.status.resultUrl,
    dataBase64: input.status.resultBase64,
    mimeType: input.status.resultMimeType,
    fetchHeaders: input.status.resultFetchHeaders,
    actualCostUsd,
    outputKind: outputKind as "image" | "video",
    assetType: assetType as "social_image" | "content_video",
    context: storedContext as unknown as CreativeReferenceContext,
  });

  let visualQuality: Record<string, unknown>;
  if (outputKind === "image") {
    try {
      const review = await reviewGeneratedCreativeImage({
        ownerId: run.owner_id,
        parentGenerationRunId: run.id,
        campaignId: run.campaign_id,
        releaseId: run.release_id,
        contentItemId,
        assetUrl: stored.asset.public_url,
        treatment: storedTreatment as unknown as CreativeTreatment,
        context: storedContext as unknown as CreativeReferenceContext,
      });
      visualQuality = { status: "reviewed", ...review };
      if (!review.passed) {
        await marketing.from("content_items").update({ approval_status: "rejected" }).eq("id", contentItemId).eq("owner_id", run.owner_id);
      }
    } catch (error) {
      visualQuality = {
        status: "unavailable",
        passed: null,
        error: error instanceof Error ? error.message : "Automated visual quality review was unavailable.",
        humanReviewRequired: true,
      };
    }
  } else {
    visualQuality = {
      status: "temporal_review_pending",
      passed: null,
      humanReviewRequired: true,
      note: "Video temporal artifact review requires sampled frames across the finished edit; a single-frame vision check is intentionally not treated as sufficient.",
    };
  }

  const qualityFailed = visualQuality.status === "reviewed" && visualQuality.passed === false;
  const completedOutput = {
    ...output,
    stage: qualityFailed ? "creative_qc_failed" : "creative_review",
    providerStatus: "completed",
    providerRaw: input.status.raw,
    resultUrl: stored.asset.public_url,
    mediaAssetId: stored.asset.id,
    contentStatus: stored.status,
    visualQuality,
    approvalRequired: !qualityFailed,
    actualCostUsd,
  };
  const { error: updateError } = await marketing.from("generation_runs").update({
    status: "completed",
    provider_request_id: providerRequestId,
    output: json(completedOutput),
    error: null,
  }).eq("id", run.id);
  if (updateError) throw new Error(updateError.message);
  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: run.owner_id,
    campaign_id: run.campaign_id,
    event_type: qualityFailed ? "content.ai_asset_qc_failed" : "content.ai_asset_ready_for_review",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      generationRunId: run.id,
      mediaAssetId: stored.asset.id,
      provider: run.provider,
      model: run.model,
      actualCostUsd,
      cohesionScore: (storedContext as unknown as CreativeReferenceContext).cohesionScore,
      visualQuality,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  return { completed: true as const, mediaAssetId: stored.asset.id, assetUrl: stored.asset.public_url, qualityFailed };
}
