import "server-only";

import { createHash } from "node:crypto";
import { getSiteUrl } from "@/lib/site-url";
import type { Json, MusicVideoGeneration } from "@/types/database";
import type { ExtendedMusicVideoGeneration, ExtendedMusicVideoProject, ExtendedMusicVideoShot, VideoDatabase } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HiggsfieldProvider, higgsfieldReadiness, resolveHiggsfieldEndpoint } from "@/lib/video-providers/higgsfield/client";
import type { GenerationOperation, ProviderStatus, VideoGenerationRequest } from "@/lib/video-providers/types";
import { routeLookDevelopmentModel } from "./model-router";
import { storeRemoteGeneratedAsset } from "./assets";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function generationRequest(value: Json): VideoGenerationRequest {
  const request = record(value);
  const operation = request.operation;
  const model = request.model;
  const prompt = request.prompt;
  const aspectRatio = request.aspectRatio;
  const resolution = request.resolution;
  if (typeof operation !== "string" || typeof model !== "string" || typeof prompt !== "string" || typeof aspectRatio !== "string" || typeof resolution !== "string") {
    throw new Error("Stored generation request is incomplete.");
  }
  return request as unknown as VideoGenerationRequest;
}

function lookPrompts(project: ExtendedMusicVideoProject) {
  const plan = record(project.production_plan);
  const prompts = plan.look_dev_prompts;
  if (!Array.isArray(prompts)) return [];
  return prompts.flatMap((item, index) => {
    const row = record(item);
    return typeof row.prompt === "string" ? [{
      index,
      label: typeof row.label === "string" ? row.label : `Look ${index + 1}`,
      purpose: typeof row.purpose === "string" ? row.purpose : "Visual reference",
      prompt: row.prompt,
    }] : [];
  });
}

function testShotIndexes(project: ExtendedMusicVideoProject) {
  const value = record(project.production_plan).test_shot_indexes;
  return new Set(Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : []);
}

export async function prepareLookGenerationRecords(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
}) {
  const provider = new HiggsfieldProvider();
  const model = routeLookDevelopmentModel();
  const result: ExtendedMusicVideoGeneration[] = [];
  for (const item of lookPrompts(input.project)) {
    const request: VideoGenerationRequest = {
      operation: "look_image",
      model: model.id,
      prompt: item.prompt,
      aspectRatio: input.project.primary_aspect_ratio,
      resolution: input.project.target_resolution,
      params: {},
    };
    const key = `look:${input.project.id}:${item.index}:${hash(request).slice(0, 24)}`;
    const { data: existing, error: existingError } = await input.db.from("music_video_generations")
      .select("*").eq("idempotency_key", key).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      result.push(existing);
      continue;
    }
    const quote = await provider.quote(request);
    const { data, error } = await input.db.from("music_video_generations").insert({
      owner_id: input.ownerId,
      project_id: input.project.id,
      shot_id: null,
      operation_type: "look_image",
      provider: "higgsfield",
      model: model.id,
      request_payload: json({ ...request, look_index: item.index, look_label: item.label, look_purpose: item.purpose }),
      provider_request_id: null,
      idempotency_key: key,
      approval_id: null,
      estimated_credits: quote.reserveCredits,
      actual_credits: null,
      billing_status: "unconfirmed",
      status: "planned",
      result_asset_id: null,
      provider_metadata: json({ quote_credits: quote.credits, reserve_credits: quote.reserveCredits, quote_source: quote.source, quote_note: quote.note ?? null }),
      prompt_version: 1,
      request_hash: hash(request),
      retry_of_id: null,
      error: null,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "Could not prepare look generation.");
    result.push(data);
  }
  return result;
}

function paidShot(strategy: ExtendedMusicVideoShot["reuse_strategy"]) {
  return strategy === "unique" || strategy === "continuation";
}

export async function prepareShotGenerationRecords(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
}) {
  const provider = new HiggsfieldProvider();
  const tests = testShotIndexes(input.project);
  const { data: shots, error: shotError } = await input.db.from("music_video_shots")
    .select("*").eq("project_id", input.project.id).eq("owner_id", input.ownerId).order("display_order");
  if (shotError) throw new Error(shotError.message);
  const result: ExtendedMusicVideoGeneration[] = [];
  for (const shot of shots ?? []) {
    if (!paidShot(shot.reuse_strategy) || !shot.selected_model || !shot.prompt) continue;
    const params = record(shot.generation_params);
    const duration = typeof params.duration === "number" ? params.duration : Math.max(4, Math.ceil((shot.end_ms - shot.start_ms) / 1000));
    const operation: GenerationOperation = tests.has(shot.display_order) ? "test_video" : "shot_video";
    const request: VideoGenerationRequest = {
      operation,
      model: shot.selected_model,
      prompt: shot.prompt,
      negativePrompt: shot.negative_prompt,
      durationSeconds: duration,
      aspectRatio: input.project.primary_aspect_ratio,
      resolution: input.project.target_resolution,
      params,
    };
    const key = `${operation}:${shot.id}:v${shot.prompt_version}:${hash(request).slice(0, 24)}`;
    const { data: existing, error: existingError } = await input.db.from("music_video_generations")
      .select("*").eq("idempotency_key", key).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) {
      result.push(existing);
      continue;
    }
    const quote = await provider.quote(request);
    const { data, error } = await input.db.from("music_video_generations").insert({
      owner_id: input.ownerId,
      project_id: input.project.id,
      shot_id: shot.id,
      operation_type: operation,
      provider: "higgsfield",
      model: shot.selected_model,
      request_payload: json(request),
      idempotency_key: key,
      approval_id: null,
      estimated_credits: quote.reserveCredits,
      actual_credits: null,
      billing_status: "unconfirmed",
      status: "planned",
      provider_metadata: json({ quote_credits: quote.credits, reserve_credits: quote.reserveCredits, quote_source: quote.source, quote_note: quote.note ?? null }),
      prompt_version: shot.prompt_version,
      request_hash: hash(request),
      retry_of_id: null,
      error: null,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "Could not prepare shot generation.");
    result.push(data);
  }
  return result;
}

export async function createApprovalEnvelope(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  project: ExtendedMusicVideoProject;
  generationIds: string[];
  label: string;
}) {
  if (!input.generationIds.length) throw new Error("Choose at least one generation for this batch.");
  const { data: generations, error } = await input.db.from("music_video_generations")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("project_id", input.project.id)
    .in("id", input.generationIds);
  if (error) throw new Error(error.message);
  if ((generations ?? []).length !== input.generationIds.length) throw new Error("One or more generation requests are unavailable.");
  if ((generations ?? []).some((generation) => generation.status !== "planned" || generation.approval_id)) {
    throw new Error("This batch contains a request that is no longer waiting for approval.");
  }
  const maxCredits = (generations ?? []).reduce((sum, generation) => sum + Number(generation.estimated_credits), 0);
  const available = Number(input.project.hard_budget_credits) - Number(input.project.spent_credits) - Number(input.project.reserved_credits);
  if (maxCredits > available + 0.0001) throw new Error(`This batch reserves ${maxCredits.toFixed(2)} credits but only ${available.toFixed(2)} remain in the project budget.`);
  const shotIds = [...new Set((generations ?? []).flatMap((generation) => generation.shot_id ? [generation.shot_id] : []))];
  const operationTypes = [...new Set((generations ?? []).map((generation) => generation.operation_type))];
  const models = [...new Set((generations ?? []).map((generation) => generation.model))];
  const approvalType = operationTypes.every((operation) => operation === "look_image") ? "look" : "generation_batch";
  const { data: approval, error: approvalError } = await input.db.from("music_video_approvals").insert({
    owner_id: input.ownerId,
    project_id: input.project.id,
    approval_type: approvalType,
    scope: json({ shot_ids: shotIds, operation_types: operationTypes, models, generation_ids: input.generationIds }),
    max_credits: Number(maxCredits.toFixed(2)),
    consumed_credits: 0,
    reserved_credits: 0,
    status: "active",
    label: input.label,
    approved_at: new Date().toISOString(),
  }).select("*").single();
  if (approvalError || !approval) throw new Error(approvalError?.message || "Could not create approval envelope.");
  const { error: updateError } = await input.db.from("music_video_generations")
    .update({ approval_id: approval.id })
    .in("id", input.generationIds)
    .eq("owner_id", input.ownerId);
  if (updateError) throw new Error(updateError.message);
  return approval;
}

function webhookUrl() {
  const token = process.env.HIGGSFIELD_WEBHOOK_SECRET?.trim();
  if (!token) return undefined;
  return `${getSiteUrl()}/api/video-director/higgsfield/webhook?token=${encodeURIComponent(token)}`;
}

async function quoteCredits(generation: ExtendedMusicVideoGeneration) {
  const metadata = record(generation.provider_metadata);
  return typeof metadata.quote_credits === "number" ? metadata.quote_credits : Math.min(generation.estimated_credits, generation.estimated_credits / 1.25);
}

export async function applyProviderStatus(input: {
  db: SupabaseClient<VideoDatabase>;
  generation: ExtendedMusicVideoGeneration;
  status: ProviderStatus;
}) {
  const generation = input.generation;
  if (input.status.status === "completed") {
    if (!input.status.resultUrl) throw new Error("Higgsfield completed without a result URL.");
    const asset = await storeRemoteGeneratedAsset({
      db: input.db,
      ownerId: generation.owner_id,
      projectId: generation.project_id,
      shotId: generation.shot_id,
      generationId: generation.id,
      provider: generation.provider,
      model: generation.model,
      remoteUrl: input.status.resultUrl,
      assetType: generation.operation_type === "look_image" ? "storyboard_frame" : "shot_preview",
    });
    const credits = await quoteCredits(generation);
    const { error: settleError } = await input.db.rpc("settle_music_video_generation", {
      p_generation_id: generation.id,
      p_actual_credits: credits,
      p_billing_status: "charged",
    });
    if (settleError) throw new Error(settleError.message);
    const { error: generationError } = await input.db.from("music_video_generations").update({
      status: "completed",
      result_asset_id: asset.id,
      completed_at: new Date().toISOString(),
      provider_metadata: json({ ...record(generation.provider_metadata), response: input.status.raw }),
      error: null,
    }).eq("id", generation.id);
    if (generationError) throw new Error(generationError.message);
    if (generation.shot_id) {
      await input.db.from("music_video_shots").update({ status: "review" }).eq("id", generation.shot_id);
    }
    await advanceAfterProviderCompletion(input.db, generation.project_id, generation.operation_type);
    return;
  }

  if (input.status.status === "failed" || input.status.status === "nsfw") {
    const { error: settleError } = await input.db.rpc("settle_music_video_generation", {
      p_generation_id: generation.id,
      p_actual_credits: 0,
      p_billing_status: "refunded",
    });
    if (settleError) throw new Error(settleError.message);
    await input.db.from("music_video_generations").update({
      status: input.status.status === "nsfw" ? "rejected_by_provider" : "failed",
      billing_status: "refunded",
      completed_at: new Date().toISOString(),
      provider_metadata: json({ ...record(generation.provider_metadata), response: input.status.raw }),
      error: input.status.status === "nsfw" ? "Provider safety rejection" : "Provider generation failed",
    }).eq("id", generation.id);
    if (generation.shot_id) await input.db.from("music_video_shots").update({ status: "failed" }).eq("id", generation.shot_id);
    return;
  }

  await input.db.from("music_video_generations").update({
    status: input.status.status === "in_progress" ? "in_progress" : "queued",
    provider_metadata: json({ ...record(generation.provider_metadata), response: input.status.raw }),
  }).eq("id", generation.id);
}

async function advanceAfterProviderCompletion(
  db: SupabaseClient<VideoDatabase>,
  projectId: string,
  operation: MusicVideoGeneration["operation_type"],
) {
  const { data: project } = await db.from("music_video_projects").select("status").eq("id", projectId).single();
  if (!project) return;
  if (operation === "look_image" && project.status === "look_dev") {
    const { data: pending } = await db.from("music_video_generations")
      .select("id")
      .eq("project_id", projectId)
      .eq("operation_type", "look_image")
      .in("status", ["approved", "submitted", "queued", "in_progress"])
      .limit(1);
    if (!pending?.length) await db.from("music_video_projects").update({ status: "look_review" }).eq("id", projectId);
  }
  if (operation === "test_video" && project.status === "test_generation") {
    const { data: pending } = await db.from("music_video_generations")
      .select("id").eq("project_id", projectId).eq("operation_type", "test_video")
      .in("status", ["approved", "submitted", "queued", "in_progress"]).limit(1);
    if (!pending?.length) await db.from("music_video_projects").update({ status: "test_review" }).eq("id", projectId);
  }
}

export async function submitGeneration(input: {
  db: SupabaseClient<VideoDatabase>;
  generation: ExtendedMusicVideoGeneration;
}) {
  const generation = input.generation;
  if (!generation.approval_id) throw new Error("Generation has no approval envelope.");
  const readiness = higgsfieldReadiness();
  if (!readiness.hasCredentials) throw new Error("Higgsfield credentials are not configured.");
  resolveHiggsfieldEndpoint(generation.model);
  const request = generationRequest(generation.request_payload);

  const { data: reserved, error: reserveError } = await input.db.rpc("reserve_music_video_generation", {
    p_generation_id: generation.id,
  });
  if (reserveError || !reserved) throw new Error(reserveError?.message || "Could not reserve generation budget.");

  try {
    const provider = new HiggsfieldProvider();
    const submission = await provider.submit(request, webhookUrl());
    const { data: updated, error } = await input.db.from("music_video_generations").update({
      provider_request_id: submission.requestId,
      status: submission.status === "in_progress" ? "in_progress" : submission.status === "completed" ? "submitted" : "queued",
      submitted_at: new Date().toISOString(),
      provider_metadata: json({ ...record(generation.provider_metadata), initial_response: submission.raw }),
      error: null,
    }).eq("id", generation.id).select("*").single();
    if (error || !updated) throw new Error(error?.message || "Could not persist Higgsfield request id.");
    if (submission.status === "completed") {
      await applyProviderStatus({ db: input.db, generation: updated, status: submission });
    }
    return updated;
  } catch (error) {
    await input.db.rpc("settle_music_video_generation", {
      p_generation_id: generation.id,
      p_actual_credits: 0,
      p_billing_status: "not_billed",
    }).catch(() => undefined);
    await input.db.from("music_video_generations").update({
      status: "failed",
      billing_status: "not_billed",
      error: error instanceof Error ? error.message : "Higgsfield submission failed",
      completed_at: new Date().toISOString(),
    }).eq("id", generation.id);
    throw error;
  }
}

export async function submitApprovalEnvelope(input: {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  approvalId: string;
}) {
  const { data: generations, error } = await input.db.from("music_video_generations")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("approval_id", input.approvalId)
    .eq("status", "planned")
    .order("created_at");
  if (error) throw new Error(error.message);
  const submitted: ExtendedMusicVideoGeneration[] = [];
  for (const generation of generations ?? []) {
    submitted.push(await submitGeneration({ db: input.db, generation }));
  }
  return submitted;
}

export async function refreshGeneration(input: {
  db: SupabaseClient<VideoDatabase>;
  generation: ExtendedMusicVideoGeneration;
}) {
  if (!input.generation.provider_request_id) throw new Error("Generation has not been submitted to Higgsfield.");
  const provider = new HiggsfieldProvider();
  const status = await provider.status(input.generation.provider_request_id);
  await applyProviderStatus({ db: input.db, generation: input.generation, status });
  return status;
}
