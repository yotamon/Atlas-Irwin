import "server-only";

import { generateGatewayVisionStructured } from "@/lib/ai/gateway-vision";
import { getAiBudgetSnapshot, loadAiControlSettings } from "@/lib/ai/control-plane";
import { parseGatewayModelList } from "@/lib/ai/gateway";
import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";
import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeTreatment } from "./creative-treatment";
import type { VisualQualityIssue } from "./creative-visual-quality";

export type CreativeVideoQualityReview = {
  version: "creative-video-quality-v1";
  passed: boolean;
  score: number;
  verdict: "approve" | "regenerate" | "manual_review";
  summary: string;
  scores: {
    temporalConsistency: number;
    artifactIntegrity: number;
    brandFit: number;
    composition: number;
    professionalFinish: number;
    genericAiRisk: number;
    textContaminationRisk: number;
  };
  issues: VisualQualityIssue[];
  regenerateGuidance: string;
  model: string;
  reviewRunId: string;
};

type ModelReview = Omit<CreativeVideoQualityReview, "version" | "passed" | "model" | "reviewRunId">;

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "summary", "scores", "issues", "regenerateGuidance"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["approve", "regenerate", "manual_review"] },
    summary: { type: "string", minLength: 10, maxLength: 700 },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["temporalConsistency", "artifactIntegrity", "brandFit", "composition", "professionalFinish", "genericAiRisk", "textContaminationRisk"],
      properties: {
        temporalConsistency: { type: "number", minimum: 0, maximum: 100 },
        artifactIntegrity: { type: "number", minimum: 0, maximum: 100 },
        brandFit: { type: "number", minimum: 0, maximum: 100 },
        composition: { type: "number", minimum: 0, maximum: 100 },
        professionalFinish: { type: "number", minimum: 0, maximum: 100 },
        genericAiRisk: { type: "number", minimum: 0, maximum: 100 },
        textContaminationRisk: { type: "number", minimum: 0, maximum: 100 },
      },
    },
    issues: {
      type: "array",
      maxItems: 14,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "detail"],
        properties: {
          code: { type: "string", minLength: 2, maxLength: 80 },
          severity: { type: "string", enum: ["blocking", "warning"] },
          detail: { type: "string", minLength: 4, maxLength: 420 },
        },
      },
    },
    regenerateGuidance: { type: "string", maxLength: 800 },
  },
} satisfies Record<string, unknown>;

const REVIEW_INSTRUCTIONS = `You are the senior finishing and temporal quality-control reviewer for the active independent music artist.
The FIRST images are chronological sample frames from one finished social video. Any final images after those may be release/brand references. Judge the actual finished video evidence, not the prompt.

Be strict about temporal evidence visible across sampled frames:
- subject/object identity drifting, morphing, disappearing or changing materials;
- hands/faces/geometry becoming malformed in some frames;
- accidental generated pseudo-text, logos, UI or watermarks appearing intermittently;
- framing that moves critical content into platform UI safe areas;
- inconsistent light, color, costume, object count or spatial logic that reads as generative instability;
- a weak first-frame promise, incoherent progression, or visual spectacle disconnected from the music/release world;
- generic AI tropes such as random neon cyberpunk, chrome humanoids, fake crowds, floating particles or meaningless holograms.

The samples are not optical flow and cannot prove every in-between frame is perfect. Use manual_review for ambiguity rather than inventing certainty. However, visible identity or geometry drift across samples is blocking.
Deterministic typography is allowed when it is clean, legible and consistent with the safe area. Gibberish or pseudo-text embedded in the imagery is blocking.
The final score means publish readiness. genericAiRisk and textContaminationRisk are risk scores where LOWER is better.`;

function json(value: unknown) {
  return value as Json;
}

function normalized(value: number) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function verdict(review: ModelReview) {
  const blocking = review.issues.some((issue) => issue.severity === "blocking");
  const score = normalized(review.score);
  const scores = review.scores;
  const passed = !blocking
    && review.verdict === "approve"
    && score >= 87
    && normalized(scores.temporalConsistency) >= 85
    && normalized(scores.artifactIntegrity) >= 88
    && normalized(scores.brandFit) >= 78
    && normalized(scores.composition) >= 78
    && normalized(scores.professionalFinish) >= 84
    && normalized(scores.genericAiRisk) <= 25
    && normalized(scores.textContaminationRisk) <= 15;
  return { passed, score };
}

async function assertBudget(ownerId: string) {
  const settings = await loadAiControlSettings(ownerId);
  if (!settings.hard_stop) return settings;
  const budget = await getAiBudgetSnapshot(ownerId, settings);
  if (budget.monthlyRemainingUsd <= 0 || budget.textRemainingUsd <= 0) {
    throw new Error("Ensemblis AI text/reasoning budget is exhausted, so temporal video QC cannot run.");
  }
  return settings;
}

export async function reviewGeneratedCreativeVideo(input: {
  ownerId: string;
  parentGenerationRunId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  finishedAssetUrl: string;
  frames: Array<{ timestampMs: number; url: string }>;
  treatment: CreativeTreatment;
  context: CreativeReferenceContext;
}): Promise<CreativeVideoQualityReview> {
  if (input.frames.length < 3) throw new Error("Temporal video QC requires at least three chronological finished-video frames.");
  const artistId = input.context.artistId;
  if (!artistId) throw new Error("Temporal video QC requires explicit artist lineage.");
  const settings = await assertBudget(input.ownerId);
  const client = createMarketingServiceClient();
  const model = process.env.ENSEMBLIS_CREATIVE_REVIEW_MODEL?.trim()
    || process.env.ATLAS_CREATIVE_REVIEW_MODEL?.trim()
    || "openai/gpt-5.6-terra";
  const fallbacks = parseGatewayModelList(
    process.env.ENSEMBLIS_CREATIVE_REVIEW_FALLBACK_MODELS
      || process.env.ATLAS_CREATIVE_REVIEW_FALLBACK_MODELS,
  );
  const started = new Date();
  const { data: run, error: createError } = await client.from("generation_runs").insert({
    owner_id: input.ownerId,
    artist_id: artistId,
    campaign_id: input.campaignId,
    release_id: input.releaseId,
    parent_run_id: input.parentGenerationRunId,
    purpose: `creative_video_quality:${input.contentItemId}`,
    task_type: "marketing.creative_quality",
    provider: "vercel-gateway",
    model,
    requested_model: model,
    prompt_version: "creative-video-quality-v1",
    input_context: json({
      artistId,
      contentItemId: input.contentItemId,
      finishedAssetUrl: input.finishedAssetUrl,
      frames: input.frames,
      treatmentVersion: input.treatment.version,
      platformPackage: input.treatment.platformPackage,
    }),
    output: json({}),
    status: "running",
    attempt_index: 0,
    started_at: started.toISOString(),
    metadata: json({ artistId, providerSort: settings.provider_sort, parentCreativeRunId: input.parentGenerationRunId }),
  }).select("id").single();
  if (createError || !run) throw new Error(createError?.message || "Temporal video quality review run could not be created.");

  try {
    const chronological = [...input.frames].sort((a, b) => a.timestampMs - b.timestampMs).slice(0, 6);
    const referenceImages = input.context.imageReferences.slice(0, Math.max(0, 8 - chronological.length));
    const gateway = await generateGatewayVisionStructured<ModelReview>({
      name: "marketing_creative_video_quality",
      schema: REVIEW_SCHEMA,
      instructions: REVIEW_INSTRUCTIONS,
      prompt: JSON.stringify({
        artistId,
        task: "Review chronological finished-video sample frames against the Creative Treatment and the active artist visual world.",
        frameOrder: chronological.map((frame, index) => ({ imageIndex: index + 1, timestampMs: frame.timestampMs })),
        referenceImageStartIndex: chronological.length + 1,
        treatment: {
          concept: input.treatment.concept,
          creativePromise: input.treatment.creativePromise,
          emotionalArc: input.treatment.emotionalArc,
          heroMotif: input.treatment.heroMotif,
          cameraLanguage: input.treatment.cameraLanguage,
          editingGrammar: input.treatment.editingGrammar,
          typographyDirection: input.treatment.typographyDirection,
          antiPatterns: input.treatment.antiPatterns,
          platformPackage: input.treatment.platformPackage,
        },
        release: input.context.release,
        brand: {
          visualWorld: input.context.brand.visualWorld,
          visualExclusions: input.context.brand.visualExclusions,
          continuityRules: input.context.brand.continuityRules,
        },
        referenceSummary: input.context.referenceSummary,
      }),
      imageUrls: [...chronological.map((frame) => frame.url), ...referenceImages.map((reference) => reference.url)],
      model,
      fallbackModels: fallbacks,
      providerSort: settings.provider_sort,
      timeoutMs: 150_000,
    });
    const final = verdict(gateway.value);
    const review: CreativeVideoQualityReview = {
      version: "creative-video-quality-v1",
      ...gateway.value,
      score: final.score,
      passed: final.passed,
      model: gateway.model,
      reviewRunId: run.id,
    };
    const completed = new Date();
    const { error: updateError } = await client.from("generation_runs").update({
      model: gateway.model,
      requested_model: gateway.requestedModel,
      routed_provider: gateway.routedProvider,
      gateway_generation_id: gateway.generationId,
      provider_request_id: gateway.requestId,
      output: json(review),
      status: "completed",
      completed_at: completed.toISOString(),
      latency_ms: completed.getTime() - started.getTime(),
      input_tokens: gateway.inputTokens,
      output_tokens: gateway.outputTokens,
      estimated_cost_usd: gateway.estimatedCostUsd,
      actual_cost_usd: gateway.estimatedCostUsd,
      fallback_used: gateway.model !== gateway.requestedModel,
      fallback_count: gateway.model !== gateway.requestedModel ? 1 : 0,
      quality_gate_passed: review.passed,
      quality_score: review.score / 100,
      quality_failures: json(review.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.detail)),
    }).eq("id", run.id).eq("owner_id", input.ownerId).eq("artist_id", artistId);
    if (updateError) throw new Error(updateError.message);
    return review;
  } catch (error) {
    const completed = new Date();
    await client.from("generation_runs").update({
      status: "failed",
      completed_at: completed.toISOString(),
      latency_ms: completed.getTime() - started.getTime(),
      error: error instanceof Error ? error.message : "Temporal video quality review failed.",
    }).eq("id", run.id).eq("owner_id", input.ownerId).eq("artist_id", artistId);
    throw error;
  }
}
