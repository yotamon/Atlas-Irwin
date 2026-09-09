import { routeVideoShot } from "@/lib/video-director/model-router";
import type { VideoResolution } from "@/lib/video-director/domain";
import type { Json } from "@/types/database";
import type {
  ExtendedMusicVideoShot,
  MusicVideoCharacter,
  VideoShotType,
} from "@/types/video-database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function json(value: unknown) {
  return value as Json;
}

export type VideoShotEditorInput = {
  description: string;
  prompt: string | null;
  shotType: VideoShotType;
  characterId: string | null;
  lipSync: boolean;
  captionEnabled: boolean;
  captionText: string;
  captionStyle: "clean" | "editorial" | "karaoke" | "poster";
  cameraIntent: string;
  reactivity: Record<string, number>;
};

export function buildVideoShotEditorMutation(input: {
  shot: ExtendedMusicVideoShot;
  editor: VideoShotEditorInput;
  artistCharacters: Array<Pick<MusicVideoCharacter, "id" | "reference_asset_ids">>;
  targetResolution: VideoResolution;
  audioUrl: string | null;
}) {
  const { shot, editor } = input;
  const allCharacterRefs = new Set(input.artistCharacters.flatMap((character) => strings(character.reference_asset_ids)));
  const chosenCharacter = editor.characterId
    ? input.artistCharacters.find((character) => character.id === editor.characterId)
    : null;
  if (editor.characterId && !chosenCharacter) throw new Error("Video character is unavailable for this artist.");

  const characterRefs = chosenCharacter ? strings(chosenCharacter.reference_asset_ids) : [];
  const baseReferences = strings(shot.reference_asset_ids).filter((id) => !allCharacterRefs.has(id));
  const referenceAssetIds = [...new Set([...baseReferences, ...characterRefs])].slice(0, 12);
  const existingPerformance = record(shot.performance_config);
  const existingProfile = record(shot.capability_profile);
  const generationIntentChanged =
    editor.shotType !== shot.shot_type
    || editor.prompt !== shot.prompt
    || editor.characterId !== shot.character_id
    || editor.lipSync !== (existingPerformance.lip_sync === true);

  const capabilityProfile = {
    ...existingProfile,
    performance_shot: editor.shotType === "performance",
    requires_audio_reference: editor.shotType === "performance" && editor.lipSync,
    continuity_critical: Boolean(editor.characterId) || existingProfile.continuity_critical === true,
  };
  const generationParams: Record<string, unknown> = { ...record(shot.generation_params) };

  if (editor.shotType === "performance" && editor.lipSync) {
    if (!input.audioUrl) throw new Error("Lip-sync performance needs accessible track audio.");
    generationParams.audio_references = [{ type: "audio_url", audio_url: input.audioUrl }];
    generationParams.performance_mode = "lip_sync";
    generationParams.generate_audio = false;
  } else {
    delete generationParams.audio_references;
    delete generationParams.performance_mode;
  }

  let selectedModel = shot.selected_model;
  let selectedProvider = shot.selected_provider;
  if (editor.shotType === "generated" || editor.shotType === "performance") {
    const route = routeVideoShot({
      generation_priority: editor.shotType === "performance" ? "consistency" : shot.generation_priority,
      capability_profile: json(capabilityProfile),
      start_asset_id: shot.start_asset_id,
      end_asset_id: shot.end_asset_id,
      reference_asset_ids: json(referenceAssetIds),
      music_context: shot.music_context,
      targetResolution: input.targetResolution,
    });
    selectedModel = route.model;
    selectedProvider = "higgsfield";
    Object.assign(generationParams, route.params);
  } else {
    selectedModel = null;
    selectedProvider = null;
  }

  return {
    description: editor.description,
    prompt: editor.prompt,
    shot_type: editor.shotType,
    character_id: editor.characterId,
    capability_profile: json(capabilityProfile),
    reference_asset_ids: json(referenceAssetIds),
    generation_priority: editor.shotType === "performance" ? "consistency" as const : shot.generation_priority,
    selected_model: selectedModel,
    selected_provider: selectedProvider,
    generation_params: json(generationParams),
    performance_config: json({ lip_sync: editor.lipSync, camera_intent: editor.cameraIntent }),
    lyrics_config: json({ enabled: editor.captionEnabled, text: editor.captionText, style: editor.captionStyle }),
    music_reactivity: json(editor.reactivity),
    editor_config: json({ ...record(shot.editor_config), camera_intent: editor.cameraIntent }),
    prompt_version: generationIntentChanged ? shot.prompt_version + 1 : shot.prompt_version,
    selected_asset_id: generationIntentChanged ? null : shot.selected_asset_id,
    status: generationIntentChanged && shot.status === "locked" ? "ready_for_generation" as const : shot.status,
    locked_at: generationIntentChanged ? null : shot.locked_at,
  };
}

export function buildTrimShotStartMutation(input: {
  editorConfig: Json;
  previousStartMs: number;
  startMs: number;
  endMs: number;
  trimmedAt: string;
}) {
  if (input.endMs <= input.startMs) throw new Error("Shot end must be after its start.");
  const editorConfig = record(input.editorConfig);
  const currentSourceOffset = typeof editorConfig.source_offset_ms === "number" && Number.isFinite(editorConfig.source_offset_ms)
    ? Math.max(0, Math.round(editorConfig.source_offset_ms))
    : 0;
  const trimDelta = input.startMs - input.previousStartMs;
  const sourceOffsetMs = Math.max(0, currentSourceOffset + trimDelta);

  return {
    start_ms: input.startMs,
    end_ms: input.endMs,
    editor_config: json({
      ...editorConfig,
      source_offset_ms: sourceOffsetMs,
      last_trim: {
        kind: "start",
        timeline_delta_ms: trimDelta,
        source_offset_ms: sourceOffsetMs,
        trimmed_at: input.trimmedAt,
      },
    }),
  };
}

export function buildHumanQualityApprovalMutation(input: {
  shot: ExtendedMusicVideoShot;
  reviewerId: string;
  reviewedAt: string;
}) {
  const { shot } = input;
  if (shot.status !== "locked" || !shot.selected_asset_id) {
    throw new Error("Choose and lock the exact shot variant before quality approval.");
  }

  const performance = record(shot.performance_config);
  const needsLipSync = shot.shot_type === "performance" && performance.lip_sync === true;
  const needsContinuity = Boolean(shot.character_id);
  if (!needsLipSync && !needsContinuity) {
    throw new Error("This shot does not require identity or lip-sync attestation.");
  }

  const current = record(shot.quality_checks);
  return {
    quality_checks: json({
      ...current,
      review_asset_id: shot.selected_asset_id,
      human_reviewed_at: input.reviewedAt,
      human_reviewer_id: input.reviewerId,
      continuity_approved: needsContinuity ? true : current.continuity_approved === true,
      lip_sync_approved: needsLipSync ? true : current.lip_sync_approved === true,
      lip_sync_review_method: needsLipSync ? "explicit_human_attestation" : current.lip_sync_review_method ?? null,
      continuity_review_method: needsContinuity ? "explicit_human_attestation" : current.continuity_review_method ?? null,
    }),
  };
}
