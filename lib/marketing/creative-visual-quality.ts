import "server-only";

import { generateGatewayVisionStructured } from "@/lib/ai/gateway-vision";
import { getAiBudgetSnapshot, loadAiControlSettings } from "@/lib/ai/control-plane";
import { parseGatewayModelList } from "@/lib/ai/gateway";
import { createMarketingServiceClient } from "./db";
import type { Json } from "@/types/database";
import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeTreatment } from "./creative-treatment";

export type VisualQualityIssue = {
  code: string;
  severity: "blocking" | "warning";
  detail: string;
};

export type CreativeVisualQualityReview = {
  version: "creative-visual-quality-v1";
  passed: boolean;
  score: number;
  verdict: "approve" | "regenerate" | "manual_review";
  summary: string;
  scores: {
    brandFit: number;
    artifactIntegrity: number;
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

type ModelReview = Omit<CreativeVisualQualityReview, "version" | "passed" | "score" | "model" | "reviewRunId"> & {
  score: number;
};

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "verdict", "summary", "scores", "issues", "regenerateGuidance"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    verdict: { type: "string", enum: ["approve", "regenerate", "manual_review"] },
    summary: { type: "string", minLength: 10, maxLength: 600 },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["brandFit", "artifactIntegrity", "composition", "professionalFinish", "genericAiRisk", "textContaminationRisk"],
      properties: {
        brandFit: { type: "number", minimum: 0, maximum: 100 },
        artifactIntegrity: { type: "number", minimum: 0, maximum: 100 },
        composition: { type: "number", minimum: 0, maximum: 100 },
        professionalFinish: { type: "number", minimum: 0, maximum: 100 },
        genericAiRisk: { type: "number", minimum: 0, maximum: 100 },
        textContaminationRisk: { type: "number", minimum: 0, maximum: 100 },
      },
    },
    issues: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "detail"],
        properties: {
          code: { type: "string", minLength: 2, maxLength: 80 },
          severity: { type: "string", enum: ["blocking", "warning"] },
          detail: { type: "string", minLength: 4, maxLength: 360 },
        },
      },
    },
    regenerateGuidance: { type: "string", maxLength: 700 },
  },
} satisfies Record<string, unknown>;

const REVIEW_INSTRUCTIONS = `You are the senior visual quality-control reviewer for the active independent music artist.
You are reviewing a generated production plate before a human is asked to approve it for publishing.

Judge the actual image, not the prompt quality. Be strict.

BLOCKING PROBLEMS include:
- obvious generative artifacts, impossible anatomy, broken hands, warped objects, duplicated geometry, smeared faces or malformed physical details;
- pseudo-text, accidental letters, fake logos, UI fragments, watermarks or gibberish typography generated into the image;
- generic AI spectacle that ignores the supplied artist/release world: random cyberpunk neon, chrome humanoids, anonymous glossy models, fake festival crowds, floating particles, meaningless holograms or synthetic luxury clichés;
- composition that fails the supplied platform safe area or has no clear focal hierarchy;
- major mismatch with release artwork, artist-specific approved references or the stated Creative Treatment;
- a result that looks like an AI demo rather than art-directed music media.

QUALITY SIGNALS:
- tactile, intentional lighting and materials;
- one coherent visual idea;
- believable detail and restraint;
- continuity with the supplied release/artist references;
- enough clean structure for deterministic typography and graphics to be added later;
- editorial or photographic craft rather than social-template aesthetics.

Do not punish an image merely for being stylized, surreal or synthetic when that is intentional and coherent. Do not require photorealism.
The final score is production readiness. genericAiRisk and textContaminationRisk are risk scores where LOWER is better.
Use verdict=regenerate for clear blocking failures, manual_review for ambiguous aesthetic calls, and approve only when this is a strong production plate.`;

function json(value: unknown) {
  return value as Json;
}

function normalizedScore(value: number) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function finalVerdict(review: ModelReview) {
  const scores = review.scores;
  const blocking = review.issues.some((issue) => issue.severity === "blocking");
  const score = normalizedScore(review.score);
  const passed = !blocking
    && review.verdict === "approve"
    && score >= 85
    && normalizedScore(scores.artifactIntegrity) >= 88
    && normalizedScore(scores.brandFit) >= 78
    && normalizedScore(scores.composition) >= 78
    && normalizedScore(scores.professionalFinish) >= 82
    && normalizedScore(scores.genericAiRisk) <= 25
    && normalizedScore(scores.textContaminationRisk) <= 15;
  return { passed, score };
}

async function assertReviewBudget(ownerId: string) {
  const settings = await loadAiControlSettings(ownerId);
  if (!settings.hard_stop) return settings;
  const budget = await getAiBudgetSnapshot(ownerId, settings);
  if (budget.monthlyRemainingUsd <= 0 || budget.textRemainingUsd <= 0) {
    throw new Error("Ensemblis AI text/reasoning budget is exhausted, so automated visual QC cannot run.");
  }
  return settings;
}

export async function reviewGeneratedCreativeImage(input: {
  ownerId: string;
  artistId: string;
  parentGenerationRunId: string;
  campaignId: string | null;
  releaseId: string | null;
  contentItemId: string;
  assetUrl: string;
  treatment: CreativeTreatment;
  context: CreativeReferenceContext;
}): Promise<CreativeVisualQualityReview> {
  if (input.context.artistId !== input.artistId) throw new Error("Visual QC context does not match its artist lineage.");
  const settings = await assertReviewBudget(input.ownerId);
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
    artist_id: input.artistId,
    campaign_id: input.campaignId,
    release_id: input.releaseId,
    parent_run_id: input.parentGenerationRunId,
    purpose: `creative_quality:${input.contentItemId}`,
    task_type: "marketing.creative_quality",
    provider: "vercel-gateway",
    model,
    requested_model: model,
    prompt_version: "creative-visual-quality-v1",
    input_context: json({
      artistId: input.artistId,
      contentItemId: input.contentItemId,
      assetUrl: input.assetUrl,
      treatmentVersion: input.treatment.version,
      platformPackage: input.treatment.platformPackage,
      referenceSummary: input.context.referenceSummary,
    }),
    output: json({}),
    status: "running",
    attempt_index: 0,
    started_at: started.toISOString(),
    metadata: json({ artistId: input.artistId, providerSort: settings.provider_sort, parentCreativeRunId: input.parentGenerationRunId }),
  }).select("id").single();
  if (createError || !run) throw new Error(createError?.message || "Visual quality review run could not be created.");

  try {
    const gateway = await generateGatewayVisionStructured<ModelReview>({
      name: "marketing_creative_quality",
      schema: REVIEW_SCHEMA,
      instructions: REVIEW_INSTRUCTIONS,
      prompt: JSON.stringify({
        artistId: input.artistId,
        task: "Review the generated asset against this production intent.",
        treatment: {
          concept: input.treatment.concept,
          creativePromise: input.treatment.creativePromise,
          heroMotif: input.treatment.heroMotif,
          cameraLanguage: input.treatment.cameraLanguage,
          lighting: input.treatment.lighting,
          texture: input.treatment.texture,
          typographyDirection: input.treatment.typographyDirection,
          sourceStrategy: input.treatment.sourceStrategy,
          antiPatterns: input.treatment.antiPatterns,
          finishingNotes: input.treatment.finishingNotes,
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
      imageUrls: [input.assetUrl, ...input.context.imageReferences.slice(0, 3).map((reference) => reference.url)],
      model,
      fallbackModels: fallbacks,
      providerSort: settings.provider_sort,
      timeoutMs: 120_000,
    });
    const verdict = finalVerdict(gateway.value);
    const review: CreativeVisualQualityReview = {
      version: "creative-visual-quality-v1",
      ...gateway.value,
      score: verdict.score,
      passed: verdict.passed,
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
    }).eq("id", run.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
    if (updateError) throw new Error(updateError.message);
    return review;
  } catch (error) {
    const completed = new Date();
    await client.from("generation_runs").update({
      status: "failed",
      completed_at: completed.toISOString(),
      latency_ms: completed.getTime() - started.getTime(),
      error: error instanceof Error ? error.message : "Visual quality review failed.",
    }).eq("id", run.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
    throw error;
  }
}
