"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVideoProjectContext, resolveProjectAudioUrl } from "@/lib/video-director/context";
import {
  createApprovalEnvelope,
  prepareShotGenerationRecords,
  refreshGeneration,
  submitApprovalEnvelope,
} from "@/lib/video-director/generation";
import { projectMediaLinkScopeFilter } from "@/lib/video-director/media-scope";
import { routeVideoShot } from "@/lib/video-director/model-router";
import { recordDirectorPreference } from "@/lib/video-director/preferences";
import { buildSourceAssemblyPlan } from "@/lib/video-director/source-auto-edit";
import type { Json } from "@/types/database";
import type { VideoDatabase, VideoShotType } from "@/types/video-database";
import type { SupabaseClient } from "@supabase/supabase-js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function json(value: unknown) {
  return value as Json;
}

function refresh(projectId: string) {
  revalidatePath(`/studio/video/${projectId}`);
}

function sourceBackedShotType(current: VideoShotType): VideoShotType {
  return current === "generated" ? "source_media" : current;
}

async function session(projectId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const baseDb = createServiceClient();
  const context = await loadVideoProjectContext(baseDb, projectId, user.id, artist.artistId);
  if (context.project.status === "archived") throw new Error("Archived video projects are read only.");
  return {
    user,
    artist,
    context,
    baseDb,
    music: asArtistScopedMusicClient(baseDb),
    db: baseDb as unknown as SupabaseClient<VideoDatabase>,
  };
}

async function allowedProjectSourceAsset(input: {
  projectId: string;
  assetId: string;
  ownerId: string;
  artistId: string;
  releaseId: string;
  trackId: string;
  db: SupabaseClient<VideoDatabase>;
  music: ReturnType<typeof asArtistScopedMusicClient>;
}) {
  const [linked, generated] = await Promise.all([
    input.music.from("media_links").select("media_asset_id")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("media_asset_id", input.assetId)
      .or(projectMediaLinkScopeFilter(input.releaseId, input.trackId))
      .limit(1).maybeSingle(),
    input.db.from("music_video_generations").select("result_asset_id")
      .eq("owner_id", input.ownerId)
      .eq("project_id", input.projectId)
      .eq("result_asset_id", input.assetId)
      .limit(1).maybeSingle(),
  ]);
  if (linked.error) throw new Error(linked.error.message);
  if (generated.error) throw new Error(generated.error.message);
  return Boolean(linked.data || generated.data);
}

async function assertArtistReferenceAssets(input: {
  assetIds: string[];
  projectId: string;
  ownerId: string;
  artistId: string;
  releaseId: string;
  trackId: string;
  db: SupabaseClient<VideoDatabase>;
  music: ReturnType<typeof asArtistScopedMusicClient>;
}) {
  for (const assetId of input.assetIds) {
    const allowed = await allowedProjectSourceAsset({
      projectId: input.projectId,
      assetId,
      ownerId: input.ownerId,
      artistId: input.artistId,
      releaseId: input.releaseId,
      trackId: input.trackId,
      db: input.db,
      music: input.music,
    });
    if (!allowed) throw new Error("Character references must belong to the active artist, release, track or video project.");
  }
}

const timingInput = z.object({
  projectId: z.uuid(),
  shotId: z.uuid(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().positive(),
});

export async function updateVideoShotTiming(input: z.infer<typeof timingInput>) {
  const parsed = timingInput.parse(input);
  if (parsed.endMs <= parsed.startMs) throw new Error("Shot end must be after its start.");
  const { user, db } = await session(parsed.projectId);
  const { error } = await db.from("music_video_shots").update({
    start_ms: parsed.startMs,
    end_ms: parsed.endMs,
  }).eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const editorStateInput = z.object({
  projectId: z.uuid(),
  patch: z.record(z.string(), z.unknown()),
});

export async function updateVideoEditorState(input: z.infer<typeof editorStateInput>) {
  const parsed = editorStateInput.parse(input);
  const { user, db, context } = await session(parsed.projectId);
  const state = record(context.project.editor_state);
  const { error } = await db.from("music_video_projects").update({
    editor_state: json({ ...state, ...parsed.patch }),
  }).eq("id", parsed.projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const characterInput = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  role: z.enum(["artist", "featured", "character"]).default("character"),
  identityPrompt: z.string().trim().max(2000).default(""),
  referenceAssetIds: z.array(z.uuid()).max(12).default([]),
});

export async function createVideoCharacter(input: z.infer<typeof characterInput>) {
  const parsed = characterInput.parse(input);
  const { user, artist, db, music, context } = await session(parsed.projectId);
  await assertArtistReferenceAssets({
    assetIds: parsed.referenceAssetIds,
    projectId: parsed.projectId,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: context.project.release_id,
    trackId: context.project.track_id,
    db,
    music,
  });
  const { error } = await db.from("music_video_characters").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    project_id: parsed.projectId,
    name: parsed.name,
    role: parsed.role,
    identity_prompt: parsed.identityPrompt,
    identity_profile: json({}),
    reference_asset_ids: json(parsed.referenceAssetIds),
    approved_asset_ids: json(parsed.referenceAssetIds),
    style_lock_strength: 0.85,
  });
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const updateCharacterInput = characterInput.extend({
  characterId: z.uuid(),
  lockStrength: z.number().min(0).max(1).default(0.85),
  continuityNotes: z.string().trim().max(3000).nullable().default(null),
});

export async function updateVideoCharacter(input: z.infer<typeof updateCharacterInput>) {
  const parsed = updateCharacterInput.parse(input);
  const { user, artist, db, music, context } = await session(parsed.projectId);
  await assertArtistReferenceAssets({
    assetIds: parsed.referenceAssetIds,
    projectId: parsed.projectId,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: context.project.release_id,
    trackId: context.project.track_id,
    db,
    music,
  });
  const { error } = await db.from("music_video_characters").update({
    name: parsed.name,
    role: parsed.role,
    identity_prompt: parsed.identityPrompt,
    reference_asset_ids: json(parsed.referenceAssetIds),
    approved_asset_ids: json(parsed.referenceAssetIds),
    style_lock_strength: parsed.lockStrength,
    continuity_notes: parsed.continuityNotes,
  }).eq("id", parsed.characterId).eq("artist_id", artist.artistId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const shotEditorInput = z.object({
  projectId: z.uuid(),
  shotId: z.uuid(),
  description: z.string().trim().min(1).max(2000),
  prompt: z.string().max(12000).nullable(),
  shotType: z.enum(["generated", "performance", "source_media", "graphic", "hold"]),
  characterId: z.uuid().nullable(),
  lipSync: z.boolean().default(false),
  captionEnabled: z.boolean().default(false),
  captionText: z.string().max(2000).default(""),
  captionStyle: z.enum(["clean", "editorial", "karaoke", "poster"]).default("clean"),
  cameraIntent: z.string().max(500).default(""),
  reactivity: z.record(z.string(), z.number().min(0).max(1)).default({}),
});

export async function updateVideoShotEditor(input: z.infer<typeof shotEditorInput>) {
  const parsed = shotEditorInput.parse(input);
  const { user, artist, db, baseDb, context } = await session(parsed.projectId);
  const { data: shot, error: shotError } = await db.from("music_video_shots").select("*")
    .eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (shotError || !shot) throw new Error(shotError?.message || "Video shot not found.");

  const { data: artistCharacters, error: charactersError } = await db.from("music_video_characters")
    .select("id,reference_asset_ids").eq("artist_id", artist.artistId).eq("owner_id", user.id);
  if (charactersError) throw new Error(charactersError.message);
  const allCharacterRefs = new Set((artistCharacters ?? []).flatMap((character) => strings(character.reference_asset_ids)));
  const chosenCharacter = parsed.characterId ? (artistCharacters ?? []).find((character) => character.id === parsed.characterId) : null;
  if (parsed.characterId && !chosenCharacter) throw new Error("Video character is unavailable for this artist.");
  const characterRefs = chosenCharacter ? strings(chosenCharacter.reference_asset_ids) : [];
  const baseReferences = strings(shot.reference_asset_ids).filter((id) => !allCharacterRefs.has(id));
  const referenceAssetIds = [...new Set([...baseReferences, ...characterRefs])].slice(0, 12);

  const existingPerformance = record(shot.performance_config);
  const existingProfile = record(shot.capability_profile);
  const generationIntentChanged =
    parsed.shotType !== shot.shot_type
    || parsed.prompt !== shot.prompt
    || parsed.characterId !== shot.character_id
    || parsed.lipSync !== (existingPerformance.lip_sync === true);
  const capabilityProfile = {
    ...existingProfile,
    performance_shot: parsed.shotType === "performance",
    requires_audio_reference: parsed.shotType === "performance" && parsed.lipSync,
    continuity_critical: Boolean(parsed.characterId) || existingProfile.continuity_critical === true,
  };
  const existingParams = record(shot.generation_params);
  const generationParams: Record<string, unknown> = { ...existingParams };
  if (parsed.shotType === "performance" && parsed.lipSync) {
    const audioUrl = await resolveProjectAudioUrl(baseDb, context.project, user.id, artist.artistId);
    if (!audioUrl) throw new Error("Lip-sync performance needs accessible track audio.");
    generationParams.audio_references = [{ type: "audio_url", audio_url: audioUrl }];
    generationParams.performance_mode = "lip_sync";
    generationParams.generate_audio = false;
  } else {
    delete generationParams.audio_references;
    delete generationParams.performance_mode;
  }

  let selectedModel = shot.selected_model;
  let selectedProvider = shot.selected_provider;
  if (parsed.shotType === "generated" || parsed.shotType === "performance") {
    const route = routeVideoShot({
      generation_priority: parsed.shotType === "performance" ? "consistency" : shot.generation_priority,
      capability_profile: json(capabilityProfile),
      start_asset_id: shot.start_asset_id,
      end_asset_id: shot.end_asset_id,
      reference_asset_ids: json(referenceAssetIds),
      music_context: shot.music_context,
      targetResolution: context.project.target_resolution,
    });
    selectedModel = route.model;
    selectedProvider = "higgsfield";
    Object.assign(generationParams, route.params);
  } else {
    selectedModel = null;
    selectedProvider = null;
  }

  const { error } = await db.from("music_video_shots").update({
    description: parsed.description,
    prompt: parsed.prompt,
    shot_type: parsed.shotType as VideoShotType,
    character_id: parsed.characterId,
    capability_profile: json(capabilityProfile),
    reference_asset_ids: json(referenceAssetIds),
    generation_priority: parsed.shotType === "performance" ? "consistency" : shot.generation_priority,
    selected_model: selectedModel,
    selected_provider: selectedProvider,
    generation_params: json(generationParams),
    performance_config: json({ lip_sync: parsed.lipSync, camera_intent: parsed.cameraIntent }),
    lyrics_config: json({ enabled: parsed.captionEnabled, text: parsed.captionText, style: parsed.captionStyle }),
    music_reactivity: json(parsed.reactivity),
    editor_config: json({ ...record(shot.editor_config), camera_intent: parsed.cameraIntent }),
    prompt_version: generationIntentChanged ? shot.prompt_version + 1 : shot.prompt_version,
    selected_asset_id: generationIntentChanged ? null : shot.selected_asset_id,
    status: generationIntentChanged && shot.status === "locked" ? "ready_for_generation" : shot.status,
    locked_at: generationIntentChanged ? null : shot.locked_at,
  }).eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const sourceInput = z.object({
  projectId: z.uuid(),
  shotId: z.uuid(),
  assetId: z.uuid(),
  sourceOffsetMs: z.number().int().min(0).default(0),
});

export async function assignVideoSourceAsset(input: z.infer<typeof sourceInput>) {
  const parsed = sourceInput.parse(input);
  const { user, artist, db, music, context } = await session(parsed.projectId);
  const { data: asset, error: assetError } = await db.from("media_assets").select("id,duration_ms")
    .eq("id", parsed.assetId).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Source asset not found.");
  const allowed = await allowedProjectSourceAsset({
    projectId: parsed.projectId,
    assetId: parsed.assetId,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: context.project.release_id,
    trackId: context.project.track_id,
    db,
    music,
  });
  if (!allowed) throw new Error("Source asset is not linked to this artist, release, track or video project.");
  const { data: shot, error: shotLookupError } = await db.from("music_video_shots").select("editor_config,shot_type")
    .eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (shotLookupError || !shot) throw new Error(shotLookupError?.message || "Video shot not found.");
  const sourceOffsetMs = asset.duration_ms
    ? Math.min(parsed.sourceOffsetMs, Math.max(0, asset.duration_ms - 250))
    : parsed.sourceOffsetMs;
  const editorConfig = record(shot.editor_config);
  const { error } = await db.from("music_video_shots").update({
    shot_type: sourceBackedShotType(shot.shot_type),
    selected_asset_id: parsed.assetId,
    selected_provider: null,
    selected_model: null,
    editor_config: json({
      ...editorConfig,
      source_offset_ms: sourceOffsetMs,
      source_selection: { source: "manual", asset_id: parsed.assetId, selected_at: new Date().toISOString() },
      source_suggestion: null,
    }),
    status: "locked",
    locked_at: new Date().toISOString(),
  }).eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  refresh(parsed.projectId);
}

const sourceAssemblyInput = z.object({ projectId: z.uuid() });

async function sourceAssemblyContext(projectId: string) {
  const state = await session(projectId);
  const { user, artist, db, baseDb, music, context } = state;
  const [shotsResult, linksResult] = await Promise.all([
    db.from("music_video_shots").select("*").eq("owner_id", user.id).eq("project_id", projectId).order("display_order"),
    music.from("media_links").select("media_asset_id,role,release_id,track_id,artist_id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .or(projectMediaLinkScopeFilter(context.project.release_id, context.project.track_id)),
  ]);
  if (shotsResult.error) throw new Error(shotsResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  const roles = new Map<string, string[]>();
  for (const link of linksResult.data ?? []) {
    roles.set(link.media_asset_id, [...new Set([...(roles.get(link.media_asset_id) ?? []), link.role])]);
  }
  const ids = [...roles.keys()];
  const assetsResult = ids.length
    ? await baseDb.from("media_assets").select("*").eq("owner_id", user.id).in("id", ids)
    : { data: [], error: null };
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  return {
    ...state,
    shots: shotsResult.data ?? [],
    assetContexts: (assetsResult.data ?? []).map((asset) => ({ asset, roles: roles.get(asset.id) ?? [] })),
  };
}

export async function planVideoSourceAssembly(input: z.infer<typeof sourceAssemblyInput>) {
  const parsed = sourceAssemblyInput.parse(input);
  const { user, db, context, shots, assetContexts } = await sourceAssemblyContext(parsed.projectId);
  const plan = buildSourceAssemblyPlan({
    shots,
    assets: assetContexts,
    targetAspectRatio: context.project.primary_aspect_ratio,
  });
  const suggestionByShot = new Map(plan.suggestions.map((suggestion) => [suggestion.shotId, suggestion]));
  for (const shot of shots.filter((item) => !item.selected_asset_id)) {
    const editorConfig = record(shot.editor_config);
    const suggestion = suggestionByShot.get(shot.id) ?? null;
    const { error } = await db.from("music_video_shots").update({
      editor_config: json({
        ...editorConfig,
        source_plan_version: plan.version,
        source_suggestion: suggestion,
      }),
    }).eq("id", shot.id).eq("project_id", parsed.projectId).eq("owner_id", user.id);
    if (error) throw new Error(error.message);
  }
  const projectState = record(context.project.editor_state);
  const { error: projectError } = await db.from("music_video_projects").update({
    editor_state: json({
      ...projectState,
      source_assembly: {
        version: plan.version,
        suggested: plan.suggestions.length,
        unresolved: plan.unresolvedShotIds.length,
        generated_shots_avoided: plan.generatedShotsAvoided,
        planned_at: new Date().toISOString(),
      },
    }),
  }).eq("id", parsed.projectId).eq("owner_id", user.id);
  if (projectError) throw new Error(projectError.message);
  refresh(parsed.projectId);
  return plan;
}

const sourceSuggestionInput = z.object({ projectId: z.uuid(), shotId: z.uuid() });

export async function applyVideoSourceSuggestion(input: z.infer<typeof sourceSuggestionInput>) {
  const parsed = sourceSuggestionInput.parse(input);
  const { user, artist, db, music, context } = await session(parsed.projectId);
  const { data: shot, error } = await db.from("music_video_shots").select("*")
    .eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (error || !shot) throw new Error(error?.message || "Video shot not found.");
  const editorConfig = record(shot.editor_config);
  const suggestion = record(editorConfig.source_suggestion);
  const assetId = typeof suggestion.assetId === "string" ? suggestion.assetId : "";
  const sourceOffsetMs = typeof suggestion.sourceOffsetMs === "number" ? Math.max(0, Math.round(suggestion.sourceOffsetMs)) : 0;
  if (!assetId) throw new Error("This shot has no current source suggestion.");
  const allowed = await allowedProjectSourceAsset({
    projectId: parsed.projectId,
    assetId,
    ownerId: user.id,
    artistId: artist.artistId,
    releaseId: context.project.release_id,
    trackId: context.project.track_id,
    db,
    music,
  });
  if (!allowed) throw new Error("Suggested source is no longer available to this artist project.");
  const { error: updateError } = await db.from("music_video_shots").update({
    shot_type: sourceBackedShotType(shot.shot_type),
    selected_asset_id: assetId,
    selected_provider: null,
    selected_model: null,
    editor_config: json({
      ...editorConfig,
      source_offset_ms: sourceOffsetMs,
      source_selection: { source: "auto_edit", ...suggestion, selected_at: new Date().toISOString() },
      source_suggestion: null,
    }),
    status: "locked",
    locked_at: new Date().toISOString(),
  }).eq("id", shot.id).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  refresh(parsed.projectId);
}

export async function applyAllVideoSourceSuggestions(input: z.infer<typeof sourceAssemblyInput>) {
  const parsed = sourceAssemblyInput.parse(input);
  const { user, artist, db, music, context } = await session(parsed.projectId);
  const { data: shots, error } = await db.from("music_video_shots").select("*")
    .eq("owner_id", user.id).eq("project_id", parsed.projectId).order("display_order");
  if (error) throw new Error(error.message);
  let applied = 0;
  for (const shot of shots ?? []) {
    if (shot.selected_asset_id) continue;
    const editorConfig = record(shot.editor_config);
    const suggestion = record(editorConfig.source_suggestion);
    const assetId = typeof suggestion.assetId === "string" ? suggestion.assetId : "";
    if (!assetId) continue;
    const allowed = await allowedProjectSourceAsset({
      projectId: parsed.projectId,
      assetId,
      ownerId: user.id,
      artistId: artist.artistId,
      releaseId: context.project.release_id,
      trackId: context.project.track_id,
      db,
      music,
    });
    if (!allowed) continue;
    const sourceOffsetMs = typeof suggestion.sourceOffsetMs === "number" ? Math.max(0, Math.round(suggestion.sourceOffsetMs)) : 0;
    const { error: updateError } = await db.from("music_video_shots").update({
      shot_type: sourceBackedShotType(shot.shot_type),
      selected_asset_id: assetId,
      selected_provider: null,
      selected_model: null,
      editor_config: json({
        ...editorConfig,
        source_offset_ms: sourceOffsetMs,
        source_selection: { source: "auto_edit", ...suggestion, selected_at: new Date().toISOString() },
        source_suggestion: null,
      }),
      status: "locked",
      locked_at: new Date().toISOString(),
    }).eq("id", shot.id).eq("project_id", parsed.projectId).eq("owner_id", user.id);
    if (updateError) throw new Error(updateError.message);
    applied += 1;
  }
  refresh(parsed.projectId);
  return { applied };
}

const shotVariantInput = z.object({ projectId: z.uuid(), shotId: z.uuid() });

export async function prepareVideoShotVariant(input: z.infer<typeof shotVariantInput>) {
  const parsed = shotVariantInput.parse(input);
  const { user, db, context } = await session(parsed.projectId);
  const { data: shot, error } = await db.from("music_video_shots").select("*")
    .eq("id", parsed.shotId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (error || !shot) throw new Error(error?.message || "Shot not found.");
  if (!["generated", "performance"].includes(shot.shot_type)) throw new Error("Only generated or performance shots can create AI variants.");
  if (!shot.prompt || !shot.selected_model) throw new Error("Save a generation-ready prompt before creating a variant.");

  const nextVersion = shot.prompt_version + 1;
  const { error: updateError } = await db.from("music_video_shots").update({ prompt_version: nextVersion })
    .eq("id", shot.id).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  await prepareShotGenerationRecords({ db, ownerId: user.id, project: context.project });
  const { data: generation, error: generationError } = await db.from("music_video_generations").select("*")
    .eq("owner_id", user.id).eq("project_id", parsed.projectId).eq("shot_id", parsed.shotId)
    .eq("prompt_version", nextVersion).eq("status", "planned").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (generationError || !generation) throw new Error(generationError?.message || "Could not prepare the new shot variant.");
  refresh(parsed.projectId);
  return { id: generation.id, estimatedCredits: Number(generation.estimated_credits), model: generation.model };
}

const generationVariantInput = z.object({ projectId: z.uuid(), generationId: z.uuid() });

export async function approveAndGenerateVideoVariant(input: z.infer<typeof generationVariantInput>) {
  const parsed = generationVariantInput.parse(input);
  const { user, db, context } = await session(parsed.projectId);
  const { data: generation, error } = await db.from("music_video_generations").select("*")
    .eq("id", parsed.generationId).eq("project_id", parsed.projectId).eq("owner_id", user.id).single();
  if (error || !generation) throw new Error(error?.message || "Variant generation not found.");
  if (generation.status !== "planned" || generation.approval_id) throw new Error("This variant is no longer waiting for approval.");
  const approval = await createApprovalEnvelope({
    db,
    ownerId: user.id,
    project: context.project,
    generationIds: [generation.id],
    label: `Editor A/B variant · ${generation.model}`,
  });
  await submitApprovalEnvelope({ db, ownerId: user.id, approvalId: approval.id });
  refresh(parsed.projectId);
}

export async function selectVideoShotVariant(input: z.infer<typeof generationVariantInput>) {
  const parsed = generationVariantInput.parse(input);
  const { user, db } = await session(parsed.projectId);
  const { data: generation, error } = await db.from("music_video_generations").select("*")
    .eq("id", parsed.generationId).eq("project_id", parsed.projectId).eq("owner_id", user.id).eq("status", "completed").single();
  if (error || !generation || !generation.shot_id || !generation.result_asset_id) throw new Error(error?.message || "Completed variant not found.");
  const { error: shotError } = await db.from("music_video_shots").update({
    selected_asset_id: generation.result_asset_id,
    status: "locked",
    locked_at: new Date().toISOString(),
    review_note: "Selected from Director Pro A/B variants",
  }).eq("id", generation.shot_id).eq("project_id", parsed.projectId).eq("owner_id", user.id);
  if (shotError) throw new Error(shotError.message);
  await recordDirectorPreference({
    db,
    ownerId: user.id,
    signal: "Selected A/B shot variant",
    positive: true,
    projectId: parsed.projectId,
    shotId: generation.shot_id,
    generationId: generation.id,
    note: `Selected ${generation.model} variant from Director Pro.`,
  });
  refresh(parsed.projectId);
}

export async function rejectVideoShotVariant(input: z.infer<typeof generationVariantInput>) {
  const parsed = generationVariantInput.parse(input);
  const { user, db } = await session(parsed.projectId);
  const { data: generation, error } = await db.from("music_video_generations").select("*")
    .eq("id", parsed.generationId).eq("project_id", parsed.projectId).eq("owner_id", user.id).eq("status", "completed").single();
  if (error || !generation || !generation.shot_id) throw new Error(error?.message || "Completed variant not found.");
  const { error: updateError } = await db.from("music_video_generations").update({
    provider_metadata: json({ ...record(generation.provider_metadata), review: "rejected", review_note: "Rejected from Director Pro A/B variants" }),
  }).eq("id", generation.id).eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  await recordDirectorPreference({
    db,
    ownerId: user.id,
    signal: "Rejected A/B shot variant",
    positive: false,
    projectId: parsed.projectId,
    shotId: generation.shot_id,
    generationId: generation.id,
    note: `Rejected ${generation.model} variant from Director Pro.`,
  });
  refresh(parsed.projectId);
}

export async function refreshVideoShotVariants(input: z.infer<typeof shotVariantInput>) {
  const parsed = shotVariantInput.parse(input);
  const { user, db } = await session(parsed.projectId);
  const { data: generations, error } = await db.from("music_video_generations").select("*")
    .eq("owner_id", user.id).eq("project_id", parsed.projectId).eq("shot_id", parsed.shotId)
    .in("status", ["submitted", "queued", "in_progress"]).not("provider_request_id", "is", null).order("created_at").limit(8);
  if (error) throw new Error(error.message);
  for (const generation of generations ?? []) {
    try { await refreshGeneration({ db, generation }); } catch { /* preserve remaining refreshes and provider ambiguity */ }
  }
  refresh(parsed.projectId);
}
