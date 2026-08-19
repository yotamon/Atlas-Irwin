"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { buildCohesiveVisualPrompt, loadCreativeReferenceContext } from "@/lib/marketing/creative-context";
import { applyMarketingCreativeProviderStatus } from "@/lib/marketing/creative-generation";
import {
  CREATIVE_MEDIA_KINDS,
  CREATIVE_QUALITY_PROFILES,
  routeMarketingCreative,
} from "@/lib/marketing/creative-router";
import { getSiteUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import {
  HiggsfieldProvider,
  isHiggsfieldDefiniteRejection,
} from "@/lib/video-providers/higgsfield/client";
import type { VideoGenerationRequest } from "@/lib/video-providers/types";
import type { Json } from "@/types/database";

const uuid = z.uuid();
const qualitySchema = z.enum(CREATIVE_QUALITY_PROFILES);
const mediaKindSchema = z.enum(CREATIVE_MEDIA_KINDS);

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
  return ["reel", "tiktok video", "short", "dj clip", "mood video"].some((token) => normalized.includes(token)) ? "video" : "image";
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

function webhookUrl(runId: string) {
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
  const creativeBrief = content.visual_prompt || content.production_notes || content.content_angle || content.hook_text || content.title;
  const prompt = buildCohesiveVisualPrompt({
    context: referenceContext,
    contentTitle: content.title,
    platform: content.platform,
    format: content.format,
    creativeBrief,
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
  const provider = new HiggsfieldProvider();
  const quote = await provider.quote(route.request);

  const { data: generation, error: generationError } = await marketing.from("generation_runs").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    release_id: content.release_id,
    purpose: `content_asset:${content.id}`,
    provider: "higgsfield",
    model: route.request.model,
    prompt_version: "creative-lineage-v1",
    input_context: json({
      contentItemId: content.id,
      outputKind: route.outputKind,
      assetType: route.assetType,
      quality,
      mediaKind,
      request: route.request,
      referenceContext,
    }),
    output: json({
      stage: "prepared",
      quote,
      routeReason: route.reason,
      cohesionScore: referenceContext.cohesionScore,
      referenceSummary: referenceContext.referenceSummary,
      approvalRequiredBeforeSpend: true,
    }),
    status: "queued",
    estimated_cost_usd: null,
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
    payload: json({ generationRunId: generation.id, model: route.request.model, quote, cohesionScore: referenceContext.cohesionScore }),
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
  const requestValue = inputContext.request;
  if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) {
    throw new Error("Prepared provider request is missing.");
  }
  const request = requestValue as unknown as VideoGenerationRequest;
  if (!request.model || !request.prompt || !request.operation) throw new Error("Prepared provider request is invalid.");

  const provider = new HiggsfieldProvider();
  try {
    const submission = await provider.submit(request, webhookUrl(run.id));
    await applyMarketingCreativeProviderStatus({ runId: run.id, status: submission });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creative generation submission failed.";
    if (isHiggsfieldDefiniteRejection(error)) {
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
  const provider = new HiggsfieldProvider();
  const status = await provider.status(run.provider_request_id);
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
  const { error } = await marketing.from("content_items").update({ approval_status: "approved" }).eq("id", content.id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    event_type: "content.ai_asset_approved",
    entity_type: "content_item",
    entity_id: content.id,
    payload: json({ assetUrl: content.asset_url }),
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
  const { error } = await marketing.from("content_items").update({ approval_status: "rejected" }).eq("id", content.id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: content.campaign_id,
    event_type: "content.ai_asset_rejected",
    entity_type: "content_item",
    entity_id: content.id,
    payload: json({ assetUrl: content.asset_url }),
  });
  if (eventError) throw new Error(eventError.message);
  revalidateCreativePaths(content);
}
