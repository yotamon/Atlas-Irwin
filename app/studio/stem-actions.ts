"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import {
  asStemClient,
  regenerateSystemAudioScenes,
} from "@/lib/music-intelligence/stem-scenes";
import {
  STEM_CATEGORIES,
  cleanStemLabel,
} from "@/lib/music-intelligence/stems";
import { mediaWorkerReadiness } from "@/lib/media-worker/sandbox";
import type { Json, MediaAsset } from "@/types/database";
import type {
  AudioScene,
  StemProvider,
  TrackStem,
} from "@/types/stem-database";

const stemCategorySchema = z.enum(STEM_CATEGORIES);
const providerSchema = z.enum(["manual", "suno", "cubase", "ableton", "logic", "other"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown): Json {
  return value as Json;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeFileName(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180) || "audio-scene.mp3";
}

async function canonicalTrackContext(trackId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const [trackResult, intelligenceResult] = await Promise.all([
    db.from("tracks")
      .select("id,owner_id,release_id,title,audio_url")
      .eq("id", trackId)
      .eq("owner_id", user.id)
      .single(),
    db.from("track_music_intelligence")
      .select("analysis,source_audio_url,source_media_asset_id")
      .eq("track_id", trackId)
      .eq("owner_id", user.id)
      .maybeSingle(),
  ]);
  if (trackResult.error || !trackResult.data) {
    throw new Error(trackResult.error?.message || "Track not found.");
  }
  const track = trackResult.data;
  if (!track.audio_url) throw new Error("Attach the canonical master before importing stems.");
  if (intelligenceResult.error) throw new Error(intelligenceResult.error.message);
  const intelligence = intelligenceResult.data;
  const musicMap = intelligence?.source_audio_url === track.audio_url ? intelligence.analysis : null;
  return { supabase, db, user, track, intelligence, musicMap };
}

function analysisSections(musicMap: Json | null) {
  const map = record(musicMap);
  if (!Array.isArray(map.sections)) return [];
  return map.sections
    .map((item) => record(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : null,
      label: typeof item.label === "string" ? item.label : "section",
      start_ms: typeof item.start_ms === "number" ? Math.max(0, Math.round(item.start_ms)) : 0,
      end_ms: typeof item.end_ms === "number" ? Math.max(1, Math.round(item.end_ms)) : 1,
    }))
    .filter((item) => item.end_ms > item.start_ms)
    .slice(0, 80);
}

async function ensureStemMediaLink(input: {
  db: ReturnType<typeof asStemClient>;
  ownerId: string;
  trackId: string;
  assetId: string;
}) {
  const existing = await input.db.from("media_links")
    .select("id")
    .eq("owner_id", input.ownerId)
    .eq("track_id", input.trackId)
    .eq("media_asset_id", input.assetId)
    .eq("role", "stem")
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.id;
  const result = await input.db.from("media_links").insert({
    owner_id: input.ownerId,
    media_asset_id: input.assetId,
    release_id: null,
    track_id: input.trackId,
    content_item_id: null,
    role: "stem",
    is_primary: false,
  }).select("id").single();
  if (result.error || !result.data) throw new Error(result.error?.message || "Could not attach the stem to the track.");
  return result.data.id;
}

async function enqueueStemAnalysis(input: {
  stem: TrackStem;
  stemUrl: string;
  masterUrl: string;
  sections: Array<Record<string, unknown>>;
}) {
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  if (!mediaWorkerReadiness().configured) {
    await db.from("track_stems").update({
      status: "failed",
      error: "Vercel Sandbox is unavailable in this deployment.",
    }).eq("id", input.stem.id).eq("owner_id", user.id);
    return { queued: false };
  }

  const idempotencyKey = `stem-analysis:${input.stem.id}:${randomUUID()}`;
  const { data: job, error } = await db.from("track_stem_jobs").insert({
    owner_id: user.id,
    track_id: input.stem.track_id,
    stem_id: input.stem.id,
    scene_id: null,
    job_type: "analyze_stem",
    status: "planned",
    idempotency_key: idempotencyKey,
    request_payload: json({
      stem_url: input.stemUrl,
      master_url: input.masterUrl,
      source_master_url: input.masterUrl,
      category: input.stem.category,
      sections: input.sections,
    }),
  }).select("id").single();
  if (error || !job) throw new Error(error?.message || "Could not queue stem analysis.");

  const update = await db.from("track_stems").update({
    status: "queued",
    error: null,
  }).eq("id", input.stem.id).eq("owner_id", user.id);
  if (update.error) throw new Error(update.error.message);
  await kickMediaWorkerQueue().catch(() => undefined);
  return { queued: true, jobId: job.id };
}

export async function registerTrackStem(form: FormData) {
  const trackId = z.uuid().parse(value(form, "track_id"));
  const mediaAssetId = z.uuid().parse(value(form, "media_asset_id"));
  const category = stemCategorySchema.parse(value(form, "category") || "other");
  const sourceProvider = providerSchema.parse(value(form, "source_provider") || "manual") as StemProvider;
  const requestedLabel = value(form, "label");
  const sourceFilename = z.string().max(500).parse(value(form, "source_filename") || "Stem");
  const { db, user, track, intelligence, musicMap } = await canonicalTrackContext(trackId);

  const assetResult = await db.from("media_assets")
    .select("*")
    .eq("id", mediaAssetId)
    .eq("owner_id", user.id)
    .single();
  if (assetResult.error || !assetResult.data) throw new Error(assetResult.error?.message || "Stem media asset not found.");
  const asset = assetResult.data as MediaAsset;
  if (asset.asset_type !== "stem" || !asset.mime_type?.startsWith("audio/") || !asset.public_url) {
    throw new Error("Stem Intelligence requires a public audio asset registered as a stem.");
  }

  await ensureStemMediaLink({ db, ownerId: user.id, trackId, assetId: mediaAssetId });
  const existing = await db.from("track_stems")
    .select("*")
    .eq("track_id", trackId)
    .eq("media_asset_id", mediaAssetId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  let stem: TrackStem;
  if (existing.data) {
    const updated = await db.from("track_stems").update({
      category,
      label: requestedLabel || cleanStemLabel(sourceFilename),
      source_provider: sourceProvider,
      source_filename: sourceFilename,
      source_master_url: track.audio_url!,
      source_master_media_asset_id: intelligence?.source_media_asset_id ?? null,
      status: "uploaded",
      error: null,
      preview_error: undefined,
    } as never).eq("id", existing.data.id).eq("owner_id", user.id).select("*").single();
    if (updated.error || !updated.data) throw new Error(updated.error?.message || "Could not update this stem.");
    stem = updated.data as TrackStem;
  } else {
    const countResult = await db.from("track_stems")
      .select("id", { count: "exact", head: true })
      .eq("track_id", trackId)
      .eq("owner_id", user.id);
    if (countResult.error) throw new Error(countResult.error.message);
    const inserted = await db.from("track_stems").insert({
      owner_id: user.id,
      track_id: trackId,
      media_asset_id: mediaAssetId,
      source_provider: sourceProvider,
      category,
      label: requestedLabel || cleanStemLabel(sourceFilename),
      source_filename: sourceFilename,
      display_order: countResult.count ?? 0,
      status: "uploaded",
      source_master_url: track.audio_url,
      source_master_media_asset_id: intelligence?.source_media_asset_id ?? null,
      analysis: json({}),
      alignment: json({}),
      user_overrides: json({}),
    }).select("*").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not register the stem.");
    stem = inserted.data as TrackStem;
  }

  const analysis = await enqueueStemAnalysis({
    stem,
    stemUrl: asset.public_url,
    masterUrl: track.audio_url,
    sections: analysisSections(musicMap),
  });
  revalidatePath(`/studio/releases/${track.release_id}`);
  revalidatePath("/studio/media");
  return { stemId: stem.id, analysisQueued: analysis.queued };
}

export async function retryStemAnalysis(form: FormData) {
  const stemId = z.uuid().parse(value(form, "stem_id"));
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const stemResult = await db.from("track_stems").select("*").eq("id", stemId).eq("owner_id", user.id).single();
  if (stemResult.error || !stemResult.data) throw new Error(stemResult.error?.message || "Stem not found.");
  const stem = stemResult.data as TrackStem;
  const context = await canonicalTrackContext(stem.track_id);
  const assetResult = await db.from("media_assets").select("public_url,mime_type").eq("id", stem.media_asset_id).eq("owner_id", user.id).single();
  if (assetResult.error || !assetResult.data?.public_url || !assetResult.data.mime_type?.startsWith("audio/")) {
    throw new Error(assetResult.error?.message || "The stem audio asset is unavailable.");
  }

  const refreshed = await db.from("track_stems").update({
    source_master_url: context.track.audio_url,
    source_master_media_asset_id: context.intelligence?.source_media_asset_id ?? null,
    status: "uploaded",
    error: null,
  }).eq("id", stem.id).eq("owner_id", user.id).select("*").single();
  if (refreshed.error || !refreshed.data) throw new Error(refreshed.error?.message || "Could not rebind this stem to the current master.");
  await enqueueStemAnalysis({
    stem: refreshed.data as TrackStem,
    stemUrl: assetResult.data.public_url,
    masterUrl: context.track.audio_url,
    sections: analysisSections(context.musicMap),
  });
  revalidatePath(`/studio/releases/${context.track.release_id}`);
}

export async function updateStemIdentity(form: FormData) {
  const stemId = z.uuid().parse(value(form, "stem_id"));
  const category = stemCategorySchema.parse(value(form, "category"));
  const label = z.string().trim().min(1).max(120).parse(value(form, "label"));
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const result = await db.from("track_stems").update({ category, label }).eq("id", stemId).eq("owner_id", user.id).select("track_id").single();
  if (result.error || !result.data) throw new Error(result.error?.message || "Stem not found.");
  const track = await db.from("tracks").select("release_id").eq("id", result.data.track_id).eq("owner_id", user.id).single();
  if (track.error || !track.data) throw new Error(track.error?.message || "Track not found.");
  await regenerateSystemAudioScenes({ client: db, ownerId: user.id, trackId: result.data.track_id });
  revalidatePath(`/studio/releases/${track.data.release_id}`);
}

export async function removeTrackStem(form: FormData) {
  const stemId = z.uuid().parse(value(form, "stem_id"));
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const stemResult = await db.from("track_stems").select("track_id,media_asset_id").eq("id", stemId).eq("owner_id", user.id).single();
  if (stemResult.error || !stemResult.data) throw new Error(stemResult.error?.message || "Stem not found.");
  const trackResult = await db.from("tracks").select("release_id").eq("id", stemResult.data.track_id).eq("owner_id", user.id).single();
  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found.");
  const deleted = await db.from("track_stems").delete().eq("id", stemId).eq("owner_id", user.id);
  if (deleted.error) throw new Error(deleted.error.message);
  await db.from("media_links").delete()
    .eq("owner_id", user.id)
    .eq("track_id", stemResult.data.track_id)
    .eq("media_asset_id", stemResult.data.media_asset_id)
    .eq("role", "stem");
  await regenerateSystemAudioScenes({ client: db, ownerId: user.id, trackId: stemResult.data.track_id });
  revalidatePath(`/studio/releases/${trackResult.data.release_id}`);
  revalidatePath("/studio/media");
}

export async function regenerateAudioScenes(form: FormData) {
  const trackId = z.uuid().parse(value(form, "track_id"));
  const { db, user, track } = await canonicalTrackContext(trackId);
  const scenes = await regenerateSystemAudioScenes({ client: db, ownerId: user.id, trackId });
  revalidatePath(`/studio/releases/${track.release_id}`);
  return { sceneCount: scenes.length };
}

function sceneRecipeLayers(scene: AudioScene) {
  const recipe = record(scene.recipe);
  if (recipe.schema !== "atlas.audio_scene.v1" || !Array.isArray(recipe.layers)) {
    throw new Error("This Audio Scene uses an unsupported recipe version.");
  }
  return recipe.layers.map(record).slice(0, 24);
}

export async function renderAudioScenePreview(form: FormData) {
  const sceneId = z.uuid().parse(value(form, "scene_id"));
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const sceneResult = await db.from("audio_scenes").select("*").eq("id", sceneId).eq("owner_id", user.id).single();
  if (sceneResult.error || !sceneResult.data) throw new Error(sceneResult.error?.message || "Audio Scene not found.");
  const scene = sceneResult.data as AudioScene;
  const context = await canonicalTrackContext(scene.track_id);
  if (scene.status === "stale") throw new Error("This Audio Scene is stale because the canonical master or stem set changed. Regenerate it first.");

  const stemsResult = await db.from("track_stems").select("*").eq("track_id", scene.track_id).eq("owner_id", user.id);
  if (stemsResult.error) throw new Error(stemsResult.error.message);
  const stems = (stemsResult.data ?? []) as TrackStem[];
  const stemById = new Map(stems.map((stem) => [stem.id, stem]));
  const stemAssetIds = stems.map((stem) => stem.media_asset_id);
  const assetsResult = stemAssetIds.length
    ? await db.from("media_assets").select("id,public_url,mime_type").in("id", stemAssetIds).eq("owner_id", user.id)
    : { data: [], error: null };
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  const assetById = new Map((assetsResult.data ?? []).map((asset) => [asset.id, asset]));

  const resolvedLayers = sceneRecipeLayers(scene).map((layer) => {
    const source = layer.source;
    if (source === "master") {
      return {
        url: context.track.audio_url,
        source: "master",
        source_offset_ms: 0,
        gain_db: typeof layer.gain_db === "number" ? layer.gain_db : 0,
        start_at_ms: typeof layer.start_at_ms === "number" ? Math.max(0, Math.round(layer.start_at_ms)) : 0,
        end_at_ms: typeof layer.end_at_ms === "number" ? Math.max(1, Math.round(layer.end_at_ms)) : undefined,
        fade_in_ms: typeof layer.fade_in_ms === "number" ? Math.max(0, Math.round(layer.fade_in_ms)) : 0,
        fade_out_ms: typeof layer.fade_out_ms === "number" ? Math.max(0, Math.round(layer.fade_out_ms)) : 0,
      };
    }
    if (source !== "stem" || typeof layer.stem_id !== "string") {
      throw new Error("Audio Scene contains an invalid layer source.");
    }
    const stem = stemById.get(layer.stem_id);
    if (!stem || stem.status !== "ready" || stem.source_master_url !== context.track.audio_url) {
      throw new Error("One of the stems in this Audio Scene is not ready for the current master.");
    }
    const asset = assetById.get(stem.media_asset_id);
    if (!asset?.public_url || !asset.mime_type?.startsWith("audio/")) {
      throw new Error(`The audio asset for ${stem.label} is unavailable.`);
    }
    return {
      url: asset.public_url,
      source: "stem",
      stem_id: stem.id,
      source_offset_ms: stem.offset_ms,
      gain_db: typeof layer.gain_db === "number" ? layer.gain_db : 0,
      start_at_ms: typeof layer.start_at_ms === "number" ? Math.max(0, Math.round(layer.start_at_ms)) : 0,
      end_at_ms: typeof layer.end_at_ms === "number" ? Math.max(1, Math.round(layer.end_at_ms)) : undefined,
      fade_in_ms: typeof layer.fade_in_ms === "number" ? Math.max(0, Math.round(layer.fade_in_ms)) : 0,
      fade_out_ms: typeof layer.fade_out_ms === "number" ? Math.max(0, Math.round(layer.fade_out_ms)) : 0,
    };
  });

  const clipStartMs = scene.recommended_start_ms ?? 0;
  const clipEndMs = scene.recommended_end_ms ?? Math.min(clipStartMs + 15000, clipStartMs + 120000);
  if (clipEndMs <= clipStartMs) throw new Error("Audio Scene has no valid preview window.");
  const bucket = "public-media";
  const outputName = safeFileName(`${scene.scene_type}-${scene.id}.mp3`);
  const path = `${user.id}/library/stem-intelligence/${scene.track_id}/${randomUUID()}-${outputName}`;
  const signed = await db.storage.from(bucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data) throw new Error(signed.error?.message || "Could not prepare the Audio Scene preview upload.");
  const signedUrl = signed.data.signedUrl;
  if (!signedUrl) throw new Error("Storage did not return a signed Audio Scene upload URL.");
  const publicUrl = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  const idempotencyKey = `audio-scene:${scene.id}:${scene.stem_set_fingerprint || "custom"}:${clipStartMs}:${clipEndMs}`;
  const existing = await db.from("track_stem_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data && ["planned", "queued", "running"].includes(existing.data.status)) {
    return { queued: true, jobId: existing.data.id };
  }

  const jobResult = await db.from("track_stem_jobs").insert({
    owner_id: user.id,
    track_id: scene.track_id,
    stem_id: null,
    scene_id: scene.id,
    job_type: "render_audio_scene",
    status: "planned",
    idempotency_key: existing.data ? `${idempotencyKey}:${randomUUID()}` : idempotencyKey,
    request_payload: json({
      layers: resolvedLayers,
      clip_start_ms: clipStartMs,
      clip_end_ms: clipEndMs,
      upload_url: signedUrl,
      upload_bucket: bucket,
      upload_path: path,
      public_url: publicUrl,
      source_master_url: context.track.audio_url,
      stem_set_fingerprint: scene.stem_set_fingerprint,
    }),
  }).select("id").single();
  if (jobResult.error || !jobResult.data) throw new Error(jobResult.error?.message || "Could not queue the Audio Scene preview.");
  const sceneUpdate = await db.from("audio_scenes").update({ status: "rendering", preview_error: null }).eq("id", scene.id).eq("owner_id", user.id);
  if (sceneUpdate.error) throw new Error(sceneUpdate.error.message);
  await kickMediaWorkerQueue().catch(() => undefined);
  revalidatePath(`/studio/releases/${context.track.release_id}`);
  return { queued: true, jobId: jobResult.data.id };
}

export async function toggleAudioScenePin(form: FormData) {
  const sceneId = z.uuid().parse(value(form, "scene_id"));
  const { supabase, user } = await requireStudioAdmin();
  const db = asStemClient(supabase);
  const scene = await db.from("audio_scenes").select("track_id,is_pinned").eq("id", sceneId).eq("owner_id", user.id).single();
  if (scene.error || !scene.data) throw new Error(scene.error?.message || "Audio Scene not found.");
  const updated = await db.from("audio_scenes").update({ is_pinned: !scene.data.is_pinned }).eq("id", sceneId).eq("owner_id", user.id);
  if (updated.error) throw new Error(updated.error.message);
  const track = await db.from("tracks").select("release_id").eq("id", scene.data.track_id).eq("owner_id", user.id).single();
  if (track.error || !track.data) throw new Error(track.error?.message || "Track not found.");
  revalidatePath(`/studio/releases/${track.data.release_id}`);
}

export async function saveCustomAudioScene(form: FormData) {
  const trackId = z.uuid().parse(value(form, "track_id"));
  const name = z.string().trim().min(1).max(100).parse(value(form, "name"));
  const recipeText = z.string().min(2).max(50000).parse(value(form, "recipe"));
  const startMs = z.coerce.number().int().nonnegative().parse(value(form, "start_ms") || "0");
  const endMs = z.coerce.number().int().positive().parse(value(form, "end_ms") || "15000");
  if (endMs <= startMs) throw new Error("Audio Scene end must be after its start.");
  const parsed = JSON.parse(recipeText) as unknown;
  const recipe = record(parsed);
  if (recipe.schema !== "atlas.audio_scene.v1" || !Array.isArray(recipe.layers)) {
    throw new Error("Custom Audio Scene recipe is invalid.");
  }
  const { db, user, track } = await canonicalTrackContext(trackId);
  const stemsResult = await db.from("track_stems").select("*").eq("track_id", trackId).eq("owner_id", user.id);
  if (stemsResult.error) throw new Error(stemsResult.error.message);
  const readyStemIds = new Set((stemsResult.data ?? []).filter((stem) => stem.status === "ready" && stem.source_master_url === track.audio_url).map((stem) => stem.id));
  for (const rawLayer of recipe.layers) {
    const layer = record(rawLayer);
    if (layer.source === "master") continue;
    if (layer.source !== "stem" || typeof layer.stem_id !== "string" || !readyStemIds.has(layer.stem_id)) {
      throw new Error("Custom Audio Scene contains a stem that is not ready for the current master.");
    }
    if (typeof layer.gain_db === "number" && (layer.gain_db < -60 || layer.gain_db > 12)) {
      throw new Error("Custom Audio Scene gain must stay between -60 dB and +12 dB.");
    }
  }
  const inserted = await db.from("audio_scenes").insert({
    owner_id: user.id,
    track_id: trackId,
    name,
    scene_type: "custom",
    source: "user",
    status: "ready",
    description: "Custom stem mix created in Atlas Stem Intelligence.",
    recipe_version: 1,
    recipe: json(recipe),
    objective_tags: ["custom"],
    platform_hints: ["story", "reel", "tiktok", "video"],
    recommended_start_ms: startMs,
    recommended_end_ms: endMs,
    score: null,
    rationale: json({ reason: "Artist-defined mix recipe." }),
    stem_set_fingerprint: null,
    is_pinned: true,
  }).select("*").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not save the custom Audio Scene.");
  revalidatePath(`/studio/releases/${track.release_id}`);
  return { sceneId: inserted.data.id };
}
