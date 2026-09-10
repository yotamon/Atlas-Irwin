import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { createMarketingServiceClient } from "./db";
import { enqueueMarketingVideoFinishing } from "./media-production";
import { socialPlatformPackages, type SocialOutputKind, type SocialPlatformPackage } from "./platform-packages";
import type { CreativeGenerationRequest } from "./creative-provider-types";
import type { CreativeReferenceContext } from "./creative-context";
import type { CreativeTreatment } from "./creative-treatment";
import type { Json } from "@/types/database";
import type { CreativeDerivativeDatabase, CreativeDerivative } from "@/types/creative-derivative-database";
import type { SocialDatabase, SocialChannelAccount } from "@/types/social-database";

function db() {
  return createMarketingServiceClient() as unknown as SupabaseClient<CreativeDerivativeDatabase>;
}

function json(value: unknown) {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function outputKind(value: unknown): SocialOutputKind | null {
  return value === "image" || value === "video" ? value : null;
}

async function connectedAccounts(ownerId: string, artistId: string) {
  const social = createServiceClient() as unknown as SupabaseClient<SocialDatabase>;
  const { data, error } = await social.from("social_channel_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("status", "connected");
  if (error) throw new Error(error.message);
  return (data ?? []) as SocialChannelAccount[];
}

function targetPackages(accounts: SocialChannelAccount[], kind: SocialOutputKind, sourcePackageId: string) {
  const connected = new Set(accounts.map((account) => account.platform));
  const allowed = new Set<string>();
  if (connected.has("instagram")) {
    if (kind === "video") {
      allowed.add("instagram-reel");
      allowed.add("instagram-story");
    } else {
      allowed.add("instagram-feed-portrait");
    }
  }
  if (connected.has("tiktok")) allowed.add(kind === "video" ? "tiktok-video" : "tiktok-photo");
  if (connected.has("youtube") && kind === "video") allowed.add("youtube-short");
  allowed.delete(sourcePackageId);
  return socialPlatformPackages().filter((item) => allowed.has(item.id));
}

function platformCopy(input: {
  sourceTitle: string;
  sourceCaption: string | null;
  sourceHook: string | null;
  sourceCta: string | null;
  target: SocialPlatformPackage;
}) {
  const hook = input.sourceHook?.trim() || null;
  const caption = input.sourceCaption?.trim() || null;
  const cta = input.sourceCta?.trim() || null;
  if (input.target.platform === "YouTube Shorts") {
    return {
      title: `${input.sourceTitle} / Short`,
      hook,
      caption: caption ? caption.slice(0, 2200) : hook,
      cta,
    };
  }
  if (input.target.platform === "TikTok") {
    return {
      title: `${input.sourceTitle} / TikTok`,
      hook,
      caption: caption ? caption.slice(0, 1800) : hook,
      cta,
    };
  }
  return {
    title: `${input.sourceTitle} / ${input.target.format}`,
    hook,
    caption,
    cta,
  };
}

async function claimDerivative(input: {
  ownerId: string;
  artistId: string;
  campaignId: string | null;
  masterContentItemId: string;
  masterGenerationRunId: string;
  target: SocialPlatformPackage;
  strategy: CreativeDerivative["strategy"];
}) {
  const client = db();
  const { data, error } = await client.from("creative_derivatives").insert({
    owner_id: input.ownerId,
    artist_id: input.artistId,
    campaign_id: input.campaignId,
    master_content_item_id: input.masterContentItemId,
    derivative_content_item_id: null,
    master_generation_run_id: input.masterGenerationRunId,
    derivative_generation_run_id: null,
    target_platform: input.target.platform,
    target_format: input.target.format,
    target_package_id: input.target.id,
    strategy: input.strategy,
    auto_approve: true,
    status: "planned",
    error: null,
  }).select("*").maybeSingle();
  if (!error && data) return { claimed: true as const, derivative: data as CreativeDerivative };
  if (error?.code !== "23505") throw new Error(error?.message || "Could not claim creative derivative.");
  const existing = await client.from("creative_derivatives")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("master_content_item_id", input.masterContentItemId)
    .eq("target_package_id", input.target.id)
    .single();
  if (existing.error || !existing.data) throw new Error(existing.error?.message || "Could not recover derivative claim.");
  return { claimed: false as const, derivative: existing.data as CreativeDerivative };
}

async function attachExistingAsset(input: {
  ownerId: string;
  releaseId: string | null;
  contentItemId: string;
  mediaAssetId: string | null;
}) {
  if (!input.mediaAssetId) return;
  const service = createServiceClient();
  const { data: existing, error: existingError } = await service.from("media_links")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("media_asset_id", input.mediaAssetId)
    .eq("content_item_id", input.contentItemId)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return;
  const { error } = await service.from("media_links").insert({
    owner_id: input.ownerId,
    media_asset_id: input.mediaAssetId,
    release_id: input.releaseId,
    track_id: null,
    content_item_id: input.contentItemId,
    role: "social_image",
    display_order: 0,
    is_primary: true,
    caption: "Approved master creative reused without generative modification",
    alt_text: null,
  });
  if (error) throw new Error(error.message);
}

async function createOneDerivative(input: {
  ownerId: string;
  artistId: string;
  sourceContent: CreativeDerivativeDatabase["public"]["Tables"]["content_items"]["Row"];
  masterRun: CreativeDerivativeDatabase["public"]["Tables"]["generation_runs"]["Row"];
  target: SocialPlatformPackage;
  kind: SocialOutputKind;
  treatment: CreativeTreatment;
  referenceContext: CreativeReferenceContext;
}) {
  if (input.sourceContent.artist_id !== input.artistId || input.masterRun.artist_id !== input.artistId || input.referenceContext.artistId !== input.artistId) {
    throw new Error("Creative derivative lineage does not match the active artist.");
  }
  const client = db();
  const strategy: CreativeDerivative["strategy"] = input.kind === "video"
    ? "deterministic_video_repackage"
    : "reuse_approved_image";
  const claim = await claimDerivative({
    ownerId: input.ownerId,
    artistId: input.artistId,
    campaignId: input.sourceContent.campaign_id,
    masterContentItemId: input.sourceContent.id,
    masterGenerationRunId: input.masterRun.id,
    target: input.target,
    strategy,
  });
  if (!claim.claimed) return { created: false as const, derivative: claim.derivative };

  let childId: string | null = null;
  try {
    const copy = platformCopy({
      sourceTitle: input.sourceContent.title,
      sourceCaption: input.sourceContent.caption,
      sourceHook: input.sourceContent.hook_text,
      sourceCta: input.sourceContent.cta,
      target: input.target,
    });
    const { data: child, error: childError } = await client.from("content_items").insert({
      owner_id: input.ownerId,
      artist_id: input.artistId,
      release_id: input.sourceContent.release_id,
      campaign_id: input.sourceContent.campaign_id,
      phase_id: input.sourceContent.phase_id,
      experiment_id: null,
      title: copy.title,
      platform: input.target.platform,
      format: input.target.format,
      status: "Draft",
      goal: input.sourceContent.goal,
      scheduled_at: input.sourceContent.scheduled_at,
      published_at: null,
      audio_timestamp_start: input.sourceContent.audio_timestamp_start,
      audio_timestamp_end: input.sourceContent.audio_timestamp_end,
      hook_text: copy.hook,
      caption: copy.caption,
      cta: copy.cta,
      visual_prompt: input.sourceContent.visual_prompt,
      production_notes: `Deterministic ${input.target.id} derivative of approved master creative ${input.sourceContent.id}. No new generative visual direction.`,
      asset_url: input.kind === "image" ? input.sourceContent.asset_url : null,
      approval_status: "pending",
      source: "ai",
      generated_from_run_id: null,
      content_angle: input.sourceContent.content_angle,
      audience_segment: input.sourceContent.audience_segment,
      relative_day: input.sourceContent.relative_day,
      schedule_locked: input.sourceContent.schedule_locked,
      schedule_local_time: input.sourceContent.schedule_local_time,
      schedule_timezone: input.sourceContent.schedule_timezone,
    }).select("*").single();
    if (childError || !child) throw new Error(childError?.message || "Could not create derivative content item.");
    childId = child.id;

    const derivativeTreatment: CreativeTreatment = {
      ...input.treatment,
      platformPackage: input.target,
      finishingNotes: [
        ...input.treatment.finishingNotes,
        `Re-master specifically for ${input.target.platform} ${input.target.format}; obey its safe area instead of mechanically cropping.`,
      ].slice(0, 12),
    };
    const sourceOutput = record(input.masterRun.output);
    const sourceInput = record(input.masterRun.input_context);
    const inheritedQuality = record(sourceOutput.visualQuality);
    const now = new Date().toISOString();
    const { data: derivativeRun, error: runError } = await client.from("generation_runs").insert({
      owner_id: input.ownerId,
      artist_id: input.artistId,
      campaign_id: input.sourceContent.campaign_id,
      release_id: input.sourceContent.release_id,
      parent_run_id: input.masterRun.id,
      purpose: `content_asset:${child.id}`,
      task_type: null,
      provider: "atlas-derivative",
      model: input.kind === "video" ? "deterministic-video-repackage-v1" : "approved-image-reuse-v1",
      requested_model: null,
      prompt_version: "creative-derivative-v1",
      input_context: json({
        artistId: input.artistId,
        contentItemId: child.id,
        outputKind: input.kind,
        assetType: input.kind === "video" ? "content_video" : "social_image",
        referenceContext: input.referenceContext,
        treatment: derivativeTreatment,
        platformPackage: input.target,
        productionGate: sourceInput.productionGate,
        derivativeOfContentItemId: input.sourceContent.id,
        derivativeOfGenerationRunId: input.masterRun.id,
        derivativeClaimId: claim.derivative.id,
        request: sourceInput.request ?? null,
      }),
      output: json(input.kind === "image" ? {
        stage: "creative_review",
        resultUrl: input.sourceContent.asset_url,
        mediaAssetId: sourceOutput.mediaAssetId ?? sourceOutput.finishedMediaAssetId ?? null,
        visualQuality: {
          ...inheritedQuality,
          status: "inherited_approved_master",
          passed: true,
          deterministicDerivative: true,
          sourceGenerationRunId: input.masterRun.id,
        },
        approvalRequired: false,
        deterministicDerivative: true,
      } : {
        stage: "derivative_preparing",
        rawResultUrl: sourceOutput.rawResultUrl ?? null,
        rawMediaAssetId: sourceOutput.rawMediaAssetId ?? null,
        approvalRequired: false,
        deterministicDerivative: true,
      }),
      status: "completed",
      attempt_index: 0,
      started_at: now,
      completed_at: now,
      latency_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
      actual_cost_usd: 0,
      fallback_used: false,
      fallback_count: 0,
      escalated: false,
      quality_gate_passed: input.kind === "image" ? true : null,
      quality_score: input.kind === "image" ? Number(input.masterRun.quality_score ?? 1) : null,
      quality_failures: json([]),
      metadata: json({
        artistId: input.artistId,
        derivativeClaimId: claim.derivative.id,
        zeroGenerationSpend: true,
        sourceGenerationRunId: input.masterRun.id,
      }),
      error: null,
    }).select("*").single();
    if (runError || !derivativeRun) throw new Error(runError?.message || "Could not create derivative generation lineage.");

    const { error: claimUpdateError } = await client.from("creative_derivatives").update({
      derivative_content_item_id: child.id,
      derivative_generation_run_id: derivativeRun.id,
      status: "processing",
      error: null,
    }).eq("id", claim.derivative.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId).eq("status", "planned");
    if (claimUpdateError) throw new Error(claimUpdateError.message);

    const { error: childLineageError } = await client.from("content_items").update({ generated_from_run_id: derivativeRun.id })
      .eq("id", child.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
    if (childLineageError) throw new Error(childLineageError.message);

    if (input.kind === "image") {
      if (!input.sourceContent.asset_url) throw new Error("Approved master image has no reusable asset URL.");
      const mediaAssetId = typeof sourceOutput.mediaAssetId === "string"
        ? sourceOutput.mediaAssetId
        : typeof sourceOutput.finishedMediaAssetId === "string"
          ? sourceOutput.finishedMediaAssetId
          : null;
      await attachExistingAsset({
        ownerId: input.ownerId,
        releaseId: input.sourceContent.release_id,
        contentItemId: child.id,
        mediaAssetId,
      });
      const { error: approveError } = await client.from("content_items").update({ approval_status: "approved" })
        .eq("id", child.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
      if (approveError) throw new Error(approveError.message);
      await client.from("creative_derivatives").update({ status: "ready", error: null })
        .eq("id", claim.derivative.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
      await client.from("marketing_events").insert({
        owner_id: input.ownerId,
        artist_id: input.artistId,
        campaign_id: input.sourceContent.campaign_id,
        event_type: "content.derivative_ready",
        entity_type: "content_item",
        entity_id: child.id,
        payload: json({
          artistId: input.artistId,
          derivativeClaimId: claim.derivative.id,
          masterContentItemId: input.sourceContent.id,
          masterGenerationRunId: input.masterRun.id,
          targetPackageId: input.target.id,
          strategy,
          zeroGenerationSpend: true,
        }),
      });
    } else {
      const rawResultUrl = typeof sourceOutput.rawResultUrl === "string" ? sourceOutput.rawResultUrl : "";
      const rawMediaAssetId = typeof sourceOutput.rawMediaAssetId === "string" ? sourceOutput.rawMediaAssetId : "";
      if (!rawResultUrl || !rawMediaAssetId) throw new Error("Approved master video has no raw provider plate for deterministic derivative rendering.");
      const requestValue = sourceInput.request;
      const request = requestValue && typeof requestValue === "object" && !Array.isArray(requestValue)
        ? requestValue as unknown as CreativeGenerationRequest
        : null;
      await enqueueMarketingVideoFinishing({
        ownerId: input.ownerId,
        artistId: input.artistId,
        campaignId: input.sourceContent.campaign_id,
        releaseId: input.sourceContent.release_id,
        contentItemId: child.id,
        generationRunId: derivativeRun.id,
        rawAssetId: rawMediaAssetId,
        rawAssetUrl: rawResultUrl,
        treatment: derivativeTreatment,
        context: input.referenceContext,
        request,
        audioWindow: {
          startSeconds: input.sourceContent.audio_timestamp_start,
          endSeconds: input.sourceContent.audio_timestamp_end,
        },
      });
    }
    return { created: true as const, derivativeId: claim.derivative.id, contentItemId: child.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Creative derivative creation failed.";
    await client.from("creative_derivatives").update({
      status: "failed",
      error: message,
      derivative_content_item_id: childId,
    }).eq("id", claim.derivative.id).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
    if (childId) {
      await client.from("content_items").update({ approval_status: "rejected", production_notes: `Derivative creation failed: ${message}` })
        .eq("id", childId).eq("owner_id", input.ownerId).eq("artist_id", input.artistId);
    }
    return { created: false as const, derivativeId: claim.derivative.id, error: message };
  }
}

export async function createApprovedMasterDerivatives(input: {
  ownerId: string;
  artistId: string;
  contentItemId: string;
  generationRunId?: string | null;
}) {
  const client = db();
  const { data: sourceContent, error: contentError } = await client.from("content_items")
    .select("*")
    .eq("id", input.contentItemId)
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .single();
  if (contentError || !sourceContent) throw new Error(contentError?.message || "Approved master content not found for the expected artist.");
  if (sourceContent.approval_status !== "approved" || sourceContent.source !== "ai") {
    return { created: 0, skipped: true as const, reason: "master_not_approved_ai" };
  }

  let runQuery = client.from("generation_runs").select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId);
  runQuery = input.generationRunId
    ? runQuery.eq("id", input.generationRunId)
    : runQuery.eq("purpose", `content_asset:${sourceContent.id}`).order("created_at", { ascending: false }).limit(1);
  const { data: masterRun, error: runError } = await runQuery.maybeSingle();
  if (runError || !masterRun) throw new Error(runError?.message || "Approved master generation lineage not found for the expected artist.");
  if (masterRun.artist_id !== sourceContent.artist_id || masterRun.artist_id !== input.artistId) {
    throw new Error("Approved master derivative lineage crosses artists.");
  }
  const sourceOutput = record(masterRun.output);
  const sourceInput = record(masterRun.input_context);
  const visualQuality = record(sourceOutput.visualQuality);
  if (sourceOutput.stage !== "creative_review" || visualQuality.passed !== true) {
    return { created: 0, skipped: true as const, reason: "master_qc_not_passed" };
  }
  const kind = outputKind(sourceInput.outputKind);
  if (!kind) throw new Error("Approved master is missing its output kind.");
  const treatmentValue = sourceInput.treatment;
  const contextValue = sourceInput.referenceContext;
  if (!treatmentValue || typeof treatmentValue !== "object" || Array.isArray(treatmentValue)) throw new Error("Approved master is missing its Creative Treatment.");
  if (!contextValue || typeof contextValue !== "object" || Array.isArray(contextValue)) throw new Error("Approved master is missing its creative reference context.");
  const treatment = treatmentValue as unknown as CreativeTreatment;
  const referenceContext = contextValue as unknown as CreativeReferenceContext;
  if (referenceContext.artistId !== input.artistId) throw new Error("Approved master creative context belongs to a different artist.");
  const accounts = await connectedAccounts(input.ownerId, input.artistId);
  const targets = targetPackages(accounts, kind, treatment.platformPackage.id);
  const results = [];
  for (const target of targets) {
    results.push(await createOneDerivative({
      ownerId: input.ownerId,
      artistId: input.artistId,
      sourceContent,
      masterRun,
      target,
      kind,
      treatment,
      referenceContext,
    }));
  }
  return {
    created: results.filter((result) => result.created).length,
    targets: targets.map((target) => target.id),
    results,
  };
}
