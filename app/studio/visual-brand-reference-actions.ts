"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSpecialistMediaSpendAllowed } from "@/lib/ai/control-plane";
import { assertArtistAiCapability } from "@/lib/artist-operating/capability-guard";
import { loadActiveVisualBrand } from "@/lib/brand/visual-brand-store";
import { applyVisualBrandReferenceProviderStatus } from "@/lib/brand/visual-brand-reference-generation";
import {
  VISUAL_BRAND_REFERENCE_PACK_SIZE,
  VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX,
  visualBrandReferencePrompt,
  visualBrandReferenceSlots,
  visualBrandRouteReferenceContext,
} from "@/lib/brand/visual-brand-reference-pack";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { routeMarketingCreative } from "@/lib/marketing/creative-router";
import { creativeProvider, isCreativeDefiniteRejection } from "@/lib/marketing/creative-providers";
import { CREATIVE_PROVIDER_IDS, type CreativeGenerationRequest, type CreativeProviderId } from "@/lib/marketing/creative-provider-types";
import { getSiteUrl } from "@/lib/site-url";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { mediaMetadata } from "@/lib/studio/media";
import type { Json, MediaAsset } from "@/types/database";

const uuid = z.uuid();
const providerSchema = z.enum(CREATIVE_PROVIDER_IDS);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function record(input: Json | unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function json(input: unknown) {
  return input as Json;
}

function numeric(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : null;
}

function revalidateVisualBrand() {
  revalidatePath("/studio/settings/brand/visual");
  revalidatePath("/studio/media");
  revalidatePath("/studio/library");
  revalidatePath("/studio/create");
}

async function actionContext(form: FormData) {
  const requestedArtistId = value(form, "artist_id") || undefined;
  const artist = await requireArtistContext(requestedArtistId);
  const { supabase, user } = await requireStudioAdmin();
  if (artist.userId !== user.id) throw new Error("Visual Brand references must be created from the active artist workspace.");
  return { artist, supabase, marketing: asMarketingClient(supabase) };
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

async function canonicalReferences(input: {
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"];
  ownerId: string;
  artistId: string;
  ids: string[];
}) {
  if (!input.ids.length) return [];
  const { data, error } = await input.supabase.from("media_assets")
    .select("*")
    .eq("owner_id", input.ownerId)
    .in("id", input.ids);
  if (error) throw new Error(error.message);
  const expectedArtistTag = `artist:${input.artistId}`.toLowerCase();
  return ((data ?? []) as MediaAsset[])
    .filter((asset) => {
      if (!asset.public_url || !asset.mime_type?.startsWith("image/") || asset.asset_type === "brand_negative_reference") return false;
      const tags = mediaMetadata(asset).tags.map((tag) => tag.toLowerCase());
      return tags.includes(expectedArtistTag) && !tags.includes("brand:avoid");
    })
    .map((asset, index) => ({
      assetId: asset.id,
      url: asset.public_url as string,
      kind: "image" as const,
      role: asset.asset_type,
      source: "brand" as const,
      title: mediaMetadata(asset).title,
      reason: "Canonical Visual Brand DNA reference deliberately selected by the artist.",
      score: 100 - index,
      isPrimary: index === 0,
    }));
}

export async function prepareVisualBrandReferencePack(form: FormData) {
  const { artist, supabase, marketing } = await actionContext(form);
  await assertArtistAiCapability({ artistId: artist.artistId, capability: "visuals" });
  const active = await loadActiveVisualBrand({ db: supabase, ownerId: artist.userId, artistId: artist.artistId });
  if (!active) throw new Error("Activate Visual Brand DNA before preparing a generated reference pack.");

  const { data: inFlight, error: inFlightError } = await marketing.from("generation_runs")
    .select("id,status,output,purpose")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .like("purpose", `${VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX}${active.id}:%`)
    .in("status", ["queued", "running"])
    .limit(VISUAL_BRAND_REFERENCE_PACK_SIZE * 2);
  if (inFlightError) throw new Error(inFlightError.message);
  if ((inFlight ?? []).some((run) => record(run.output).stage !== "discarded")) {
    throw new Error("A reference pack for this active identity is already prepared or generating. Finish or discard it before preparing another.");
  }

  const references = await canonicalReferences({
    supabase,
    ownerId: artist.userId,
    artistId: artist.artistId,
    ids: active.canonicalAssetIds,
  });
  if (references.length < 3) throw new Error("Keep at least three valid positive canonical image references before generating an identity pack.");
  const routeContext = visualBrandRouteReferenceContext(references);
  const slots = visualBrandReferenceSlots(active.dna);
  const prepared = await Promise.all(slots.map(async (slot) => {
    const prompt = visualBrandReferencePrompt(active.dna, slot);
    const route = routeMarketingCreative({
      platform: "Visual Brand DNA",
      format: "identity reference",
      title: slot.label,
      prompt,
      quality: "balanced",
      mediaKind: "image",
      aspectRatio: slot.aspectRatio,
      context: routeContext,
    });
    const provider = creativeProvider(route.request.provider);
    const quote = await provider.quote(route.request);
    return { slot, prompt, route, quote };
  }));

  const packId = randomUUID();
  const rows = prepared.map(({ slot, prompt, route, quote }) => ({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: null,
    release_id: null,
    purpose: `${VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX}${active.id}:${slot.key}`,
    provider: route.request.provider,
    model: route.request.model,
    prompt_version: "visual-brand-reference-pack-v1",
    input_context: json({
      artistId: artist.artistId,
      visualBrandVersionId: active.id,
      visualBrandVersion: active.version,
      packId,
      slotKey: slot.key,
      slotLabel: slot.label,
      slotPurpose: slot.purpose,
      aspectRatio: slot.aspectRatio,
      outputKind: "image",
      quality: "balanced",
      prompt,
      request: route.request,
      referenceAssetIds: references.map((reference) => reference.assetId).filter(Boolean),
      automaticIdentityMutation: false,
    }),
    output: json({
      stage: "prepared",
      quote,
      routeReason: route.reason,
      priceLabel: route.priceLabel,
      approvalRequiredBeforeSpend: true,
      reviewRequiredBeforeIdentityUse: true,
      defaultRelationshipAfterGeneration: "experimental",
    }),
    status: "queued" as const,
    estimated_cost_usd: quote.usdEstimate,
    provider_request_id: null,
    error: null,
  }));
  const { error: insertError } = await marketing.from("generation_runs").insert(rows);
  if (insertError) throw new Error(insertError.message);
  revalidateVisualBrand();
}

async function packRuns(marketing: ReturnType<typeof asMarketingClient>, ownerId: string, artistId: string, packId: string) {
  const { data, error } = await marketing.from("generation_runs")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .like("purpose", `${VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX}%`)
    .contains("input_context", { packId, artistId })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function existingVisualReferenceSpend(marketing: ReturnType<typeof asMarketingClient>, ownerId: string) {
  const { data, error } = await marketing.from("generation_runs")
    .select("status,actual_cost_usd,estimated_cost_usd")
    .eq("owner_id", ownerId)
    .like("purpose", `${VISUAL_BRAND_REFERENCE_PURPOSE_PREFIX}%`)
    .in("status", ["running", "completed"]);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, run) => sum + (numeric(run.actual_cost_usd) ?? numeric(run.estimated_cost_usd) ?? 0), 0);
}

export async function approveVisualBrandReferencePack(form: FormData) {
  const { artist, supabase, marketing } = await actionContext(form);
  await assertArtistAiCapability({ artistId: artist.artistId, capability: "visuals" });
  const packId = uuid.parse(value(form, "pack_id"));
  const runs = await packRuns(marketing, artist.userId, artist.artistId, packId);
  if (runs.length !== VISUAL_BRAND_REFERENCE_PACK_SIZE) throw new Error("This reference pack is incomplete. Discard it and prepare a fresh pack.");
  const active = await loadActiveVisualBrand({ db: supabase, ownerId: artist.userId, artistId: artist.artistId });
  if (!active) throw new Error("Visual Brand DNA is no longer active.");
  for (const run of runs) {
    const context = record(run.input_context);
    if (context.visualBrandVersionId !== active.id || context.artistId !== artist.artistId) throw new Error("The prepared pack no longer matches the active Visual Brand DNA.");
    if (run.status !== "queued" || record(run.output).stage !== "prepared") throw new Error("This pack is no longer waiting for spend approval.");
  }
  const estimates = runs.map((run) => numeric(run.estimated_cost_usd));
  if (estimates.some((estimate) => estimate === null)) throw new Error("At least one reference has no reliable USD estimate, so Ensemblis cannot approve this pack safely.");
  const estimatedTotal = estimates.reduce<number>((sum, estimate) => sum + (estimate ?? 0), 0);
  const alreadySpent = await existingVisualReferenceSpend(marketing, artist.userId);
  await assertSpecialistMediaSpendAllowed({
    ownerId: artist.userId,
    kind: "image",
    estimatedUsd: estimatedTotal,
    externalKindSpentUsd: alreadySpent,
  });

  for (const run of runs) {
    const context = record(run.input_context);
    const requestValue = context.request;
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) throw new Error("Prepared Visual Brand provider request is missing.");
    const request = requestValue as unknown as CreativeGenerationRequest;
    const providerId = providerSchema.parse(run.provider);
    if (request.provider !== providerId || request.operation !== "look_image" || !request.prompt || !request.model) {
      throw new Error("Prepared Visual Brand provider request is invalid.");
    }
    const provider = creativeProvider(providerId);
    try {
      const submission = await provider.submit(request, webhookUrl(providerId, run.id));
      await applyVisualBrandReferenceProviderStatus({ runId: run.id, artistId: artist.artistId, status: submission });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Visual Brand reference submission failed.";
      const output = record(run.output);
      if (isCreativeDefiniteRejection(error)) {
        await marketing.from("generation_runs").update({
          status: "failed",
          error: message,
          output: json({ ...output, stage: "failed_before_submission" }),
        }).eq("id", run.id).eq("artist_id", artist.artistId);
      } else {
        await marketing.from("generation_runs").update({
          status: "running",
          error: message,
          output: json({
            ...output,
            stage: "submission_ambiguous",
            warning: "Ensemblis did not receive a definitive provider response, so automatic retry is blocked to avoid duplicate paid generation.",
          }),
        }).eq("id", run.id).eq("artist_id", artist.artistId);
      }
    }
  }
  revalidateVisualBrand();
}

export async function refreshVisualBrandReferencePack(form: FormData) {
  const { artist, marketing } = await actionContext(form);
  const packId = uuid.parse(value(form, "pack_id"));
  const runs = await packRuns(marketing, artist.userId, artist.artistId, packId);
  for (const run of runs) {
    if (run.status !== "running" || !run.provider_request_id) continue;
    const context = record(run.input_context);
    const requestValue = context.request;
    if (!requestValue || typeof requestValue !== "object" || Array.isArray(requestValue)) continue;
    const request = requestValue as unknown as CreativeGenerationRequest;
    const providerId = providerSchema.parse(run.provider);
    if (request.provider !== providerId) continue;
    const provider = creativeProvider(providerId);
    const status = await provider.status(run.provider_request_id, request);
    await applyVisualBrandReferenceProviderStatus({ runId: run.id, artistId: artist.artistId, status });
  }
  revalidateVisualBrand();
}

export async function discardPreparedVisualBrandReferencePack(form: FormData) {
  const { artist, marketing } = await actionContext(form);
  const packId = uuid.parse(value(form, "pack_id"));
  const runs = await packRuns(marketing, artist.userId, artist.artistId, packId);
  if (!runs.length) return;
  if (runs.some((run) => run.status !== "queued" || record(run.output).stage !== "prepared")) {
    throw new Error("A pack can only be discarded before any paid provider submission begins.");
  }
  const ids = runs.map((run) => run.id);
  const { error } = await marketing.from("generation_runs")
    .delete()
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  revalidateVisualBrand();
}
