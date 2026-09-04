"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { recordCreativeMemoryEvent, upsertCreativeAssetProfile } from "@/lib/creative-memory/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { parseVideoCreativeBrief } from "@/lib/video-director/domain";
import { HiggsfieldProvider } from "@/lib/video-providers/higgsfield/client";
import type { VideoGenerationRequest } from "@/lib/video-providers/types";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function record(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function json(input: unknown): Json {
  return input as Json;
}

function fingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

async function loadLookGeneration(projectId: string, generationId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = createServiceClient();
  const music = asArtistScopedMusicClient(db);
  const [{ data: project, error: projectError }, { data: generation, error: generationError }] = await Promise.all([
    db.from("music_video_projects").select("*").eq("id", projectId).eq("owner_id", user.id).single(),
    db.from("music_video_generations").select("*")
      .eq("id", generationId)
      .eq("project_id", projectId)
      .eq("owner_id", user.id)
      .eq("operation_type", "look_image")
      .single(),
  ]);
  if (projectError || !project) throw new Error(projectError?.message || "Video project not found.");
  if (generationError || !generation) throw new Error(generationError?.message || "Look generation not found.");
  const { data: release, error: releaseError } = await music.from("releases")
    .select("id,artist_id")
    .eq("id", project.release_id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (releaseError || !release) throw new Error(releaseError?.message || "Look generation does not belong to the active artist.");
  return { db, user, artist, project, generation };
}

async function rememberLookDecision(input: {
  db: ReturnType<typeof createServiceClient>;
  ownerId: string;
  artistId: string;
  project: { id: string; release_id: string; track_id: string; creative_brief: Json };
  generationId: string;
  assetId: string;
  eventType: "reference_rejected" | "shot_replaced";
  signal: string;
  weight: number;
}) {
  const brief = parseVideoCreativeBrief(input.project.creative_brief);
  await upsertCreativeAssetProfile({
    db: input.db,
    ownerId: input.ownerId,
    artistId: input.artistId,
    assetId: input.assetId,
    semanticDescriptors: [input.signal],
    brandRelevance: 0.3,
    evidence: {
      source: "look_review",
      project_id: input.project.id,
      generation_id: input.generationId,
    },
    reviewed: true,
  });
  await recordCreativeMemoryEvent({
    db: input.db,
    ownerId: input.ownerId,
    artistId: input.artistId,
    assetId: input.assetId,
    releaseId: input.project.release_id,
    trackId: input.project.track_id,
    momentId: brief.anchor_moment_id,
    videoProjectId: input.project.id,
    eventType: input.eventType,
    sentiment: -1,
    weight: input.weight,
    signal: input.signal,
    source: "look_review",
    idempotencyKey: `look-${input.eventType}:${input.generationId}:${input.signal.toLowerCase().slice(0, 80)}`,
    context: { generation_id: input.generationId },
  });
}

export async function rejectLookReference(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const generationId = z.uuid().parse(value(form, "generation_id"));
  const reason = z.string().trim().max(1000).parse(value(form, "reason"));
  const { db, user, artist, project, generation } = await loadLookGeneration(projectId, generationId);
  if (project.status !== "look_review") throw new Error("Look frames can be rejected during look review.");
  if (generation.status !== "completed" || !generation.result_asset_id) throw new Error("Only completed look frames can be rejected.");

  const { data: asset, error: assetError } = await db.from("media_assets").select("*")
    .eq("id", generation.result_asset_id).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Look asset not found.");
  const rejectionSignal = reason || "Rejected during look review";
  const nextMetadata = {
    ...record(asset.metadata),
    look_rejected: true,
    look_rejection_reason: rejectionSignal,
    look_rejected_at: new Date().toISOString(),
  };
  const { error: assetUpdateError } = await db.from("media_assets")
    .update({ metadata: json(nextMetadata) }).eq("id", asset.id).eq("owner_id", user.id);
  if (assetUpdateError) throw new Error(assetUpdateError.message);

  const { error: generationUpdateError } = await db.from("music_video_generations").update({
    provider_metadata: json({
      ...record(generation.provider_metadata),
      look_review: { decision: "rejected", reason: reason || null, at: new Date().toISOString() },
    }),
  }).eq("id", generation.id).eq("owner_id", user.id);
  if (generationUpdateError) throw new Error(generationUpdateError.message);

  await rememberLookDecision({
    db,
    ownerId: user.id,
    artistId: artist.artistId,
    project,
    generationId,
    assetId: asset.id,
    eventType: "reference_rejected",
    signal: rejectionSignal,
    weight: 4,
  });
  revalidatePath(`/studio/video/${project.id}`);
}

export async function reviseLookReference(form: FormData) {
  const projectId = z.uuid().parse(value(form, "project_id"));
  const generationId = z.uuid().parse(value(form, "generation_id"));
  const instruction = z.string().trim().min(3).max(1500).parse(value(form, "instruction"));
  const { db, user, artist, project, generation } = await loadLookGeneration(projectId, generationId);
  if (project.status !== "look_review") throw new Error("Look revisions can be requested during look review.");
  if (generation.status !== "completed") throw new Error("Revise a completed look frame.");

  const original = record(generation.request_payload);
  const originalPrompt = typeof original.prompt === "string" ? original.prompt : "";
  if (!originalPrompt) throw new Error("Stored look prompt is unavailable.");
  const request: VideoGenerationRequest = {
    operation: "look_image",
    model: generation.model,
    prompt: `${originalPrompt}\n\nRequested visual revision: ${instruction}`,
    aspectRatio: project.primary_aspect_ratio,
    resolution: project.target_resolution,
    params: record(original.params),
  };
  const requestHash = fingerprint(request);
  const key = `look-revision:${generation.id}:v${generation.prompt_version + 1}:${requestHash.slice(0, 24)}`;
  const { data: existing, error: existingError } = await db.from("music_video_generations")
    .select("*").eq("owner_id", user.id).eq("idempotency_key", key).maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (!existing) {
    const quote = await new HiggsfieldProvider().quote(request);
    const originalLabel = typeof original.look_label === "string" ? original.look_label : "Look reference";
    const originalPurpose = typeof original.look_purpose === "string" ? original.look_purpose : "Visual reference";
    const { error } = await db.from("music_video_generations").insert({
      owner_id: user.id,
      project_id: project.id,
      shot_id: null,
      operation_type: "look_image",
      provider: "higgsfield",
      model: generation.model,
      request_payload: json({
        ...request,
        look_label: `${originalLabel} · revision`,
        look_purpose: originalPurpose,
        revision_instruction: instruction,
        revision_of_generation_id: generation.id,
      }),
      provider_request_id: null,
      idempotency_key: key,
      approval_id: null,
      estimated_credits: quote.reserveCredits,
      actual_credits: null,
      billing_status: "unconfirmed",
      status: "planned",
      result_asset_id: null,
      provider_metadata: json({
        quote_credits: quote.credits,
        reserve_credits: quote.reserveCredits,
        quote_source: quote.source,
        quote_note: quote.note ?? null,
        requested_revision: instruction,
      }),
      prompt_version: generation.prompt_version + 1,
      request_hash: requestHash,
      retry_of_id: generation.id,
      error: null,
    });
    if (error) throw new Error(error.message);
  }

  if (generation.result_asset_id) {
    await rememberLookDecision({
      db,
      ownerId: user.id,
      artistId: artist.artistId,
      project,
      generationId,
      assetId: generation.result_asset_id,
      eventType: "shot_replaced",
      signal: `Requested revision: ${instruction}`,
      weight: 2.5,
    });
  }

  const { error: projectUpdateError } = await db.from("music_video_projects").update({
    status: "look_dev",
    last_error: null,
  }).eq("id", project.id).eq("owner_id", user.id);
  if (projectUpdateError) throw new Error(projectUpdateError.message);

  revalidatePath(`/studio/video/${project.id}`);
}
