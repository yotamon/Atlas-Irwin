"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSpecialistMediaSpendAllowed } from "@/lib/ai/control-plane";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { buildCohesiveVisualPrompt, loadCreativeReferenceContext } from "@/lib/marketing/creative-context";
import { applyMarketingCreativeProviderStatus } from "@/lib/marketing/creative-generation";
import { assessCreativeProductionPreflight, assertCreativeProductionGate } from "@/lib/marketing/creative-quality";
import {
  CREATIVE_MEDIA_KINDS,
  CREATIVE_QUALITY_PROFILES,
  routeMarketingCreative,
} from "@/lib/marketing/creative-router";
import { directContentCreative } from "@/lib/marketing/creative-treatment";
import { creativeProvider, isCreativeDefiniteRejection } from "@/lib/marketing/creative-providers";
import { CREATIVE_PROVIDER_IDS, type CreativeGenerationRequest, type CreativeProviderId } from "@/lib/marketing/creative-provider-types";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

const uuid = z.uuid();
const qualitySchema = z.enum(CREATIVE_QUALITY_PROFILES);
const mediaKindSchema = z.enum(CREATIVE_MEDIA_KINDS);
const providerSchema = z.enum(CREATIVE_PROVIDER_IDS);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(input: unknown) {
  return input as Json;
}

function record(input: Json | unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function outputKindFor(format: string, preference: (typeof CREATIVE_MEDIA_KINDS)[number]) {
  if (preference !== "auto") return preference;
  const normalized = format.toLowerCase();
  return ["reel", "tiktok video", "short", "dj clip", "mood video", "story"].some((token) => normalized.includes(token)) ? "video" : "image";
}

function revalidateCreativePaths(content: { id: string; release_id: string | null; campaign_id: string | null }) {
  revalidatePath("/studio");
  revalidatePath("/studio/production");
  revalidatePath("/studio/inbox");
  revalidatePath("/studio/calendar");
  revalidatePath("/studio/media");
  if (content.release_id) revalidatePath(`/studio/releases/${content.release_id}`);
  if (content.campaign_id) revalidatePath(`/studio/campaigns/${content.campaign_id}`);
}

function webhookUrl(provider: CreativeProviderId, runId: string) {
  if (provider !== "higgsfield") return undefined;
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET?.trim();
  if (!secret) return undefined;
  const url = new URL("/api/studio/marketing/higgsfield/webhook", getSiteUrl());
  url.searchParams.set("token", secret);
  url.searchParams.set("run", runId);
  return url.toString();
}

export async function prepareContentCreativeGeneration(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  const quality = qualitySchema.parse(value(form, "quality") || "balanced");
  const mediaKind = mediaKindSchema.parse(value(form, "media_kind") || "auto");
  const { data: content, error: contentError } = await marketing.from("content_items")
    .select("*")
    .eq("id", contentItemId)
    .eq("owner_id", user.id)
    .single();
  if (contentError || !content) throw new Error(contentError?.message || "Content item not found.");
  if (content.status === "Published" || content.status === "Archived") {
    throw new Error("Published or archived content cannot start a new creative generation.");
  }

  const db = createServiceClient();
  const referenceContext = await loadCreativeReferenceContext({
    db,
    ownerId: user.id,
    releaseId: content.release_id,
    contentItemId: content.id,
  });
  const outputKind = outputKindFor(content.format, mediaKind);
  const { treatment, generationRunId: treatmentGenerationRunId } = await directContentCreative({
    ownerId: user.id,
    content,
    context: referenceContext,
    outputKind,
  });
  const prompt = buildCohesiveVisualPrompt({
    context: referenceContext,
    contentTitle: content.title,
    platform: content.platform,
    format: content.format,
    creativeBrief: treatment.generationPrompt,
    hook: content.hook_text,
    outputKind,
  });
  const route = routeMarketingCreative({
    platform: content.platform,
    format: content.format,
    title: content.title,
    prompt,
    quality,
    mediaKind,
    audioStart: content.audio_timestamp_start,
    audioEnd: content.audio_timestamp_end,
    context: referenceContext,
  });
  const productionGate = assessCreativeProductionPreflight({ treatment, context: referenceContext, route });
  assertCreativeProductionGate(productionGate);

  const provider = creativeProvider(route.request.provider);
  const quote = await provider.quote(route.request);

  const { data: generation, error: generationError } = await marketing.from("generation_runs").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    release_id: content.release_id,
    purpose: `content_asset:${content.id}`,
    provider: route.request.provider,
    model: route.request.model,
    prompt_version: "creative-lineage-v3-creative-director",
    input_context: json({
      contentItemId: content.id,
      outputKind: route.outputKind,
      assetType: route.assetType,
      quality,
      mediaKind,
      request: route.request,
      referenceContext,
      treatment,
      treatmentGenerationRunId,
      platformPackage: treatment.platformPackage,
      productionGate,
      fallbackUsed: route.fallbackUsed,
      preferredProvider: route.preferredProvider,
      priceLabel: route.priceLabel,
    }),
    output: json({
      stage: "prepared",
      quote,
      routeReason: route.reason,
      cohesionScore: referenceContext.cohesionScore,
      referenceSummary: referenceContext.referenceSummary,
      treatmentVersion: treatment.version,
      productionGate,
      approvalRequiredBeforeSpend: true,
      humanVisualReviewRequiredAfterGeneration: true,
      pricingAsOf: "2026-08-19",
    }),
    status: "queued",
    estimated_cost_usd: quote.usdEstimate,
    provider_request_id: null,
    error: null,
  }).select("id").single();
  if (generationError || !generation) throw new Error(generationError?.message || "Could not prepare the creative generation.");

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    event_type: "content.ai_asset_prepared",
    entity_type: "content_item",
    entity_id: content.id,
    payload: json({
      generationRunId: generation.id,
      treatmentGenerationRunId,
      treatmentVersion: treatment.version,
      provider: route.request.provider,
      model: route.request.model,
      quality,
      quote,
      cohesionScore: referenceContext.cohesionScore,
      productionGateScore: productionGate.score,
      platformPackageId: treatment.platformPackage.id,
      fallbackUsed: route.fallbackUsed,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  revalidateCreativePaths(content);
}

export async function approvePreparedCreativeGeneration(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const runId = uuid.parse(value(form, "generation_run_id"));
  const { data: run, error: runError } = await marketing.from("generation_runs")
    .select("*")
    .eq("id", runId)
    .eq("owner_id", user.id)
    .single();
  if (runError || !run) throw new Error(runError?.message || "Generation run not found.");
  if (!run.purpose.startsWith("content_asset:")) throw new Error("This is not a content creative generation.");
  const output = record(run.output);
  if (run.status !== "queued" || output.stage !== "prepared") {
    throw new Error("This generation is no longer waiting for spend approval.");
  }
  const inputContext = record(run.input_context);
  const productionGate = record(inputContext.productionGate);
  if (productionGate.passed !== true) {
    throw new Error("This creative did not pass the production gate and cannot spend on provider generation.");
  }
  if (!inputContext.treatment || !inputContext.platformPackage) {
    throw new Error("This creative is missing Creative Director treatment lineage. Prepare it again before generation.");
  }
  const requestValue = inputContext.request;
  if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
    throw new Error("Prepared provider request is missing.");
  }
  const request = requestValue as unknown as CreativeGenerationRequest;
  const providerId = providerSchema.parse(run.provider);
  if (request.provider !== providerId || !request.model || !request.prompt || !request.operation) {
    throw new Error("Prepared provider request is invalid or no longer matches the stored provider.");
  }
  const outputKind = inputContext.outputKind;
  if (outputKind !== "image" && outputKind !== "video") {
    throw new Error("Prepared generation is missing its media spend category.");
  }
  await assertSpecialistMediaSpendAllowed({
    ownerId: user.id,
    kind: outputKind,
    estimatedUsd: typeof run.estimated_cost_usd === "number" ? run.estimated_cost_usd : null,
  });

  const provider = creativeProvider(providerId);
  try {
    const submission = await provider.submit(request, webhookUrl(providerId, run.id));
    await applyMarketingCreativeProviderStatus({ runId: run.id, status: submission });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creative generation submission failed.";
    if (isCreativeDefiniteRejection(error)) {
      await marketing.from("generation_runs").update({ status: "failed", error: message, output: json({ ...output, stage: "failed_before_submission" }) }).eq("id", run.id);
    } else {
      await marketing.from("generation_runs").update({
        status: "running",
        error: message,
        output: json({
          ...output,
          stage: "submission_ambiguous",
          warning: "Atlas did not receive a definitive provider response, so automatic retry is blocked to avoid duplicate paid generations.",
        }),
      }).eq("id", run.id);
    }
    throw error;
  }

  const contentItemId = uuid.parse(run.purpose.slice("content_asset:".length));
  const { data: content } = await marketing.from("content_items").select("id,release_id,campaign_id").eq("id", contentItemId).eq("owner_id", user.id).maybeSingle();
  if (content) revalidateCreativePaths(content);
}

export async function refreshCreativeGeneration(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const runId = uuid.parse(value(form, "generation_run_id"));
  const { data: run, error: runError } = await marketing.from("generation_runs")
    .select("*")
    .eq("id", runId)
    .eq("owner_id", user.id)
    .single();
  if (runError || !run) throw new Error(runError?.message || "Generation run not found.");
  if (run.status === "completed" || run.status === "failed") return;
  if (!run.provider_request_id) throw new Error("This generation has no provider request id yet. Atlas will not retry an ambiguous paid submission automatically.");
  const inputContext = record(run.input_context);
  const requestValue = inputContext.request;
  if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) throw new Error("Stored provider request is missing.");
  const request = requestValue as unknown as CreativeGenerationRequest;
  const providerId = providerSchema.parse(run.provider);
  if (request.provider !== providerId) throw new Error("Stored provider request does not match the generation provider.");
  const provider = creativeProvider(providerId);
  const status = await provider.status(run.provider_request_id, request);
  await applyMarketingCreativeProviderStatus({ runId: run.id, status });
  const contentItemId = uuid.parse(run.purpose.slice("content_asset:".length));
  const { data: content } = await marketing.from("content_items").select("id,release_id,campaign_id").eq("id", contentItemId).eq("owner_id", user.id).maybeSingle();
  if (content) revalidateCreativePaths(content);
}

export async function discardPreparedCreativeGeneration(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const runId = uuid.parse(value(form, "generation_run_id"));
  const { data: run, error: runError } = await marketing.from("generation_runs").select("id,status,output,purpose").eq("id", runId).eq("owner_id", user.id).single();
  if (runError || !run) throw new Error(runError?.message || "Generation run not found.");
  if (run.status !== "queued" || record(run.output).stage !== "prepared") throw new Error("Only an unsubmitted prepared generation can be discarded.");
  const { error } = await marketing.from("generation_runs").delete().eq("id", run.id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const contentItemId = uuid.parse(run.purpose.slice("content_asset:".length));
  const { data: content } = await marketing.from("content_items").select("id,release_id,campaign_id").eq("id", contentItemId).eq("owner_id", user.id).maybeSingle();
  if (content) revalidateCreativePaths(content);
}

export async function approveGeneratedCreative(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  const { data: content, error: contentError } = await marketing.from("content_items").select("id,release_id,campaign_id,asset_url,source").eq("id", contentItemId).eq("owner_id", user.id).single();
  if (contentError || !content) throw new Error(contentError?.message || "Content item not found.");
  if (!content.asset_url || content.source !== "ai") throw new Error("There is no AI-generated creative attached to approve.");

  const { data: generation, error: generationError } = await marketing.from("generation_runs")
    .select("id,input_context,output")
    .eq("owner_id", user.id)
    .eq("purpose", `content_asset:${content.id}`)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (generationError) throw new Error(generationError.message);
  if (!generation) throw new Error("The generated asset has no completed production lineage and cannot be approved.");
  const inputContext = record(generation.input_context);
  const productionGate = record(inputContext.productionGate);
  const treatment = record(inputContext.treatment);
  if (productionGate.passed !== true || productionGate.humanVisualReviewRequired !== true || !treatment.version) {
    throw new Error("This asset is missing a passed production gate or Creative Director treatment. Regenerate it through Production before approval.");
  }

  const reviewedAt = new Date().toISOString();
  const runOutput = record(generation.output);
  const { error: generationUpdateError } = await marketing.from("generation_runs").update({
    user_outcome: "accepted",
    output: json({
      ...runOutput,
      productionGate: {
        ...productionGate,
        humanVisualApprovedAt: reviewedAt,
      },
    }),
  }).eq("id", generation.id).eq("owner_id", user.id);
  if (generationUpdateError) throw new Error(generationUpdateError.message);

  const { error } = await marketing.from("content_items").update({ approval_status: "approved" }).eq("id", content.id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    event_type: "content.ai_asset_approved",
    entity_type: "content_item",
    entity_id: content.id,
    payload: json({
      assetUrl: content.asset_url,
      generationRunId: generation.id,
      treatmentVersion: treatment.version,
      productionGateScore: productionGate.score,
      humanVisualApprovedAt: reviewedAt,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  revalidateCreativePaths(content);
}

export async function rejectGeneratedCreative(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  const { data: content, error: contentError } = await marketing.from("content_items").select("id,release_id,campaign_id,asset_url,source").eq("id", contentItemId).eq("owner_id", user.id).single();
  if (contentError || !content) throw new Error(contentError?.message || "Content item not found.");
  if (!content.asset_url || content.source !== "ai") throw new Error("There is no AI-generated creative attached to reject.");

  const { data: generation, error: generationError } = await marketing.from("generation_runs")
    .select("id,output")
    .eq("owner_id", user.id)
    .eq("purpose", `content_asset:${content.id}`)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (generationError) throw new Error(generationError.message);
  const rejectedAt = new Date().toISOString();
  if (generation) {
    const runOutput = record(generation.output);
    const { error: generationUpdateError } = await marketing.from("generation_runs").update({
      user_outcome: "rejected",
      output: json({ ...runOutput, humanVisualRejectedAt: rejectedAt }),
    }).eq("id", generation.id).eq("owner_id", user.id);
    if (generationUpdateError) throw new Error(generationUpdateError.message);
  }

  const { error } = await marketing.from("content_items").update({ approval_status: "rejected" }).eq("id", content.id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    event_type: "content.ai_asset_rejected",
    entity_type: "content_item",
    entity_id: content.id,
    payload: json({ assetUrl: content.asset_url, generationRunId: generation?.id ?? null, humanVisualRejectedAt: rejectedAt }),
  });
  if (eventError) throw new Error(eventError.message);
  revalidateCreativePaths(content);
}
