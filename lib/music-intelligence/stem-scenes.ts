import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSmartAudioScenes } from "@/lib/music-intelligence/stems";
import type { Database, Json } from "@/types/database";
import type { AudioScene, StemDatabase, TrackStem } from "@/types/stem-database";

export const AUDIO_SCENE_RECIPE_VERSION = 2;

export function asStemClient(client: SupabaseClient<Database> | SupabaseClient<StemDatabase>) {
  return client as unknown as SupabaseClient<StemDatabase>;
}

function json(value: unknown): Json {
  return value as Json;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stemSetFingerprint(stems: TrackStem[]) {
  const material = stems
    .filter((stem) => stem.status === "ready")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((stem) => ({
      id: stem.id,
      category: stem.category,
      hash: stem.source_stem_sha256,
      analysisVersion: stem.analysis_version,
      offsetMs: stem.offset_ms,
      overrides: stem.user_overrides,
    }));
  return createHash("sha256").update(stableJson(material)).digest("hex");
}

async function loadStemIntelligenceState(
  client: SupabaseClient<Database> | SupabaseClient<StemDatabase>,
  ownerId: string,
  trackId: string,
) {
  const db = asStemClient(client);
  const [trackResult, stemsResult, scenesResult, musicResult] = await Promise.all([
    db.from("tracks").select("id,audio_url").eq("id", trackId).eq("owner_id", ownerId).maybeSingle(),
    db.from("track_stems").select("*").eq("track_id", trackId).eq("owner_id", ownerId).order("display_order").order("created_at"),
    db.from("audio_scenes").select("*").eq("track_id", trackId).eq("owner_id", ownerId).order("is_pinned", { ascending: false }).order("score", { ascending: false, nullsFirst: false }),
    db.from("track_music_intelligence").select("analysis,analysis_version,source_audio_url").eq("track_id", trackId).eq("owner_id", ownerId).maybeSingle(),
  ]);
  const error = trackResult.error || stemsResult.error || scenesResult.error || musicResult.error;
  if (error) throw new Error(error.message);
  return {
    track: trackResult.data,
    stems: (stemsResult.data ?? []) as TrackStem[],
    scenes: (scenesResult.data ?? []) as AudioScene[],
    musicMap: musicResult.data?.analysis ?? null,
    musicAnalysisVersion: musicResult.data?.analysis_version ?? null,
    musicSourceAudioUrl: musicResult.data?.source_audio_url ?? null,
  };
}

export async function loadStemIntelligence(
  client: SupabaseClient<Database> | SupabaseClient<StemDatabase>,
  ownerId: string,
  trackId: string,
) {
  const state = await loadStemIntelligenceState(client, ownerId, trackId);
  const hasCurrentReadyStem = Boolean(state.track?.audio_url) && state.stems.some(
    (stem) => stem.status === "ready" && stem.source_master_url === state.track?.audio_url,
  );
  const needsRecipeUpgrade = state.scenes.some(
    (scene) => scene.source === "system" && scene.recipe_version < AUDIO_SCENE_RECIPE_VERSION,
  );
  if (!hasCurrentReadyStem || !needsRecipeUpgrade) return state;

  await regenerateSystemAudioScenes({ client, ownerId, trackId });
  return loadStemIntelligenceState(client, ownerId, trackId);
}

export async function regenerateSystemAudioScenes({
  client,
  ownerId,
  trackId,
}: {
  client: SupabaseClient<Database> | SupabaseClient<StemDatabase>;
  ownerId: string;
  trackId: string;
}) {
  const db = asStemClient(client);
  const state = await loadStemIntelligenceState(db, ownerId, trackId);
  if (!state.track?.audio_url) return [] as AudioScene[];
  const currentStems = state.stems.filter(
    (stem) => stem.status === "ready" && stem.source_master_url === state.track?.audio_url,
  );
  if (!currentStems.length) return [] as AudioScene[];
  const musicMap = state.musicSourceAudioUrl === state.track.audio_url ? state.musicMap : null;
  const drafts = buildSmartAudioScenes(currentStems, musicMap);
  const fingerprint = stemSetFingerprint(currentStems);
  const existing = new Map(
    state.scenes.filter((scene) => scene.source === "system").map((scene) => [scene.scene_type, scene]),
  );
  const activeTypes = new Set(drafts.map((draft) => draft.sceneType));
  const output: AudioScene[] = [];

  for (const draft of drafts) {
    const previous = existing.get(draft.sceneType);
    const fingerprintChanged = previous?.stem_set_fingerprint !== fingerprint;
    const recipeVersionChanged = previous?.recipe_version !== AUDIO_SCENE_RECIPE_VERSION;
    const row = {
      owner_id: ownerId,
      track_id: trackId,
      name: draft.name,
      scene_type: draft.sceneType,
      source: "system" as const,
      status: "ready" as const,
      description: draft.description,
      recipe_version: AUDIO_SCENE_RECIPE_VERSION,
      recipe: json(draft.recipe),
      objective_tags: draft.objectiveTags,
      platform_hints: draft.platformHints,
      recommended_start_ms: Math.max(0, Math.round(draft.recommendedStartMs)),
      recommended_end_ms: Math.max(1, Math.round(draft.recommendedEndMs)),
      score: Math.round(draft.score * 10000) / 10000,
      rationale: json(draft.rationale),
      stem_set_fingerprint: fingerprint,
      preview_asset_id: fingerprintChanged || recipeVersionChanged ? null : previous?.preview_asset_id ?? null,
      preview_error: null,
      is_pinned: previous?.is_pinned ?? false,
    };

    const result = previous
      ? await db.from("audio_scenes").update(row).eq("id", previous.id).eq("owner_id", ownerId).select("*").single()
      : await db.from("audio_scenes").insert(row).select("*").single();
    if (result.error || !result.data) throw new Error(result.error?.message || `Could not persist ${draft.name}.`);
    output.push(result.data as AudioScene);
  }

  const orphaned = state.scenes.filter((scene) => scene.source === "system" && !activeTypes.has(scene.scene_type));
  if (orphaned.length) {
    const { error } = await db.from("audio_scenes").update({
      status: "stale",
      preview_asset_id: null,
      preview_error: "The current stem set no longer supports this automatically generated scene.",
    }).in("id", orphaned.map((scene) => scene.id)).eq("owner_id", ownerId);
    if (error) throw new Error(error.message);
  }

  return output;
}
