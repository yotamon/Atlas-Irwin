import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaKind, mediaMetadata } from "@/lib/studio/media";
import type { Json, MediaAsset, MediaLink } from "@/types/database";
import type { AudioScene, StemDatabase } from "@/types/stem-database";
import type { VideoDatabase } from "@/types/video-database";

export type CreativeReferenceSource = "release" | "brand" | "content" | "approved_library";

export type CreativeReference = {
  assetId: string | null;
  url: string;
  kind: "image" | "video";
  role: string;
  source: CreativeReferenceSource;
  title: string;
  reason: string;
  score: number;
  isPrimary: boolean;
};

export type CreativeAudioSceneReference = {
  id: string;
  name: string;
  type: AudioScene["scene_type"];
  description: string;
  startMs: number | null;
  endMs: number | null;
  score: number;
  objectiveTags: string[];
  platformHints: string[];
  previewUrl: string | null;
  isPinned: boolean;
  selectionReason: string;
};

export type CreativeReferenceContext = {
  release: {
    id: string | null;
    title: string;
    artworkUrl: string | null;
    visualDirection: string;
    colorPalette: string[];
  };
  brand: {
    visualWorld: string;
    visualExclusions: string;
    promptTemplate: string;
    continuityRules: string;
  };
  imageReferences: CreativeReference[];
  videoReferences: CreativeReference[];
  identityAssets: CreativeReference[];
  audioReferenceUrl: string | null;
  audioScenes: CreativeAudioSceneReference[];
  selectedAudioScene: CreativeAudioSceneReference | null;
  cohesionScore: number;
  referenceSummary: string;
};

type ContextInput = {
  db: SupabaseClient<VideoDatabase>;
  ownerId: string;
  releaseId?: string | null;
  contentItemId?: string | null;
};

const BRAND_ASSET_TYPES = new Set(["brand_reference", "brand_logo", "brand_motion_reference"]);
const APPROVED_REFERENCE_TAGS = new Set([
  "atlas-brand",
  "brand-reference",
  "visual-language",
  "approved-reference",
  "approved-creative",
]);

function record(value: Json | unknown): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function textFromBrandContent(value: Json) {
  const row = record(value);
  return typeof row.text === "string" ? row.text.trim() : "";
}

function httpUrl(value: string | null | undefined) {
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : null;
}

function referenceScore(link: MediaLink | undefined, asset: MediaAsset, source: CreativeReferenceSource) {
  const role = link?.role || asset.asset_type;
  let score = source === "release" ? 78 : source === "brand" ? 72 : source === "content" ? 64 : 50;
  if (role === "cover") score += 42;
  if (role === "alternate_artwork") score += 26;
  if (role === "brand_reference") score += 24;
  if (role === "brand_motion_reference") score += 18;
  if (role === "social_image" || role === "content_video") score += 10;
  if (link?.is_primary) score += 12;
  return score;
}

function referenceReason(link: MediaLink | undefined, asset: MediaAsset, source: CreativeReferenceSource) {
  const role = link?.role || asset.asset_type;
  if (source === "release" && role === "cover") return "Primary release artwork and the strongest visual anchor for this campaign.";
  if (source === "release" && role === "alternate_artwork") return "Approved alternate artwork from the same release world.";
  if (source === "release") return `Existing ${role.replaceAll("_", " ")} already attached to this release.`;
  if (source === "content") return "Existing media already attached to this exact content item, useful for continuity when revising.";
  if (source === "brand" && role === "brand_motion_reference") return "Approved Atlas Irwin motion language reference.";
  if (source === "brand" && role === "brand_logo") return "Official Atlas Irwin identity asset. Use as identity evidence, not as a generative style shortcut.";
  if (source === "brand") return "Approved Atlas Irwin visual-language reference.";
  return "Library asset explicitly tagged as an approved creative reference.";
}

function tags(asset: MediaAsset) {
  return new Set(mediaMetadata(asset).tags.map((tag) => tag.toLowerCase()));
}

function sourceForAsset(asset: MediaAsset, link: MediaLink | undefined, releaseId?: string | null, contentItemId?: string | null): CreativeReferenceSource | null {
  if (link?.content_item_id && link.content_item_id === contentItemId) return "content";
  if (link?.release_id && link.release_id === releaseId) return "release";
  if (BRAND_ASSET_TYPES.has(asset.asset_type)) return "brand";
  const assetTags = tags(asset);
  if ([...APPROVED_REFERENCE_TAGS].some((tag) => assetTags.has(tag))) return "approved_library";
  return null;
}

function dedupeAndLimit(references: CreativeReference[], limit: number) {
  const seen = new Set<string>();
  return references
    .sort((a, b) => b.score - a.score)
    .filter((reference) => {
      const key = reference.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function summarizeReferences(
  imageReferences: CreativeReference[],
  videoReferences: CreativeReference[],
  artworkUrl: string | null,
  audioScene: CreativeAudioSceneReference | null,
) {
  const parts = [
    artworkUrl ? "release artwork locked as primary anchor" : "no release artwork available",
    imageReferences.length ? `${imageReferences.length} image reference${imageReferences.length === 1 ? "" : "s"}` : "no reusable image references",
    videoReferences.length ? `${videoReferences.length} motion reference${videoReferences.length === 1 ? "" : "s"}` : "no motion reference",
    audioScene ? `${audioScene.name} selected as the musical treatment` : "canonical master remains the audio reference",
  ];
  return parts.join("; ");
}

function sceneDescription(scene: AudioScene) {
  const reason = record(scene.rationale).reason;
  return typeof reason === "string" ? reason : scene.description || "Stem-aware musical treatment.";
}

function sceneFit(scene: AudioScene, contextText: string, platform: string) {
  const text = contextText.toLowerCase();
  const sceneType = scene.scene_type;
  let score = (scene.score ?? 0.5) * 100;
  if (scene.is_pinned) score += 28;
  if (scene.platform_hints.some((hint) => platform.toLowerCase().includes(hint.toLowerCase()))) score += 14;
  if (/voiceover|voice over|talking|explain|explainer|tutorial|announcement|behind.?the.?scenes|process|storytime/.test(text)) {
    if (sceneType === "voiceover_bed") score += 48;
    if (sceneType === "atmosphere") score += 16;
    if (sceneType === "full_impact") score -= 18;
  }
  if (/lyric|lyrics|vocal|voice|sing|singer|phrase/.test(text)) {
    if (sceneType === "vocal_spotlight") score += 42;
    if (sceneType === "vocal_to_drop") score += 18;
  }
  if (/breakdown|making|production|producer|layer|stem|arrangement|inside the track/.test(text)) {
    if (sceneType === "progressive_reveal") score += 46;
    if (sceneType === "instrument_spotlight") score += 32;
  }
  if (/dance|groove|bass|drum|rhythm|movement|club|loop/.test(text)) {
    if (sceneType === "groove") score += 38;
    if (sceneType === "instrument_spotlight") score += 12;
  }
  if (/drop|hook|teaser|reveal|transition|payoff|launch|release day/.test(text)) {
    if (sceneType === "vocal_to_drop") score += 36;
    if (sceneType === "full_impact") score += 20;
    if (sceneType === "progressive_reveal") score += 14;
  }
  if (/mood|cinematic|visual|text|quote|artwork|world/.test(text) && sceneType === "atmosphere") score += 26;
  if (sceneType === "full_impact") score += 5;
  return score;
}

function toAudioSceneReference(scene: AudioScene, previewUrl: string | null, selectionReason: string): CreativeAudioSceneReference {
  return {
    id: scene.id,
    name: scene.name,
    type: scene.scene_type,
    description: sceneDescription(scene),
    startMs: scene.recommended_start_ms,
    endMs: scene.recommended_end_ms,
    score: scene.score ?? 0.5,
    objectiveTags: scene.objective_tags,
    platformHints: scene.platform_hints,
    previewUrl,
    isPinned: scene.is_pinned,
    selectionReason,
  };
}

export async function loadCreativeReferenceContext({ db, ownerId, releaseId, contentItemId }: ContextInput): Promise<CreativeReferenceContext> {
  const stemDb = db as unknown as SupabaseClient<StemDatabase>;
  const [releaseResult, brandResult, assetResult, linkResult, tracksResult, contentResult] = await Promise.all([
    releaseId
      ? db.from("releases")
          .select("id,title,artwork_url,visual_direction,color_palette")
          .eq("id", releaseId)
          .eq("owner_id", ownerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("brand_settings").select("section,content").eq("owner_id", ownerId),
    db.from("media_assets").select("*").eq("owner_id", ownerId),
    db.from("media_links").select("*").eq("owner_id", ownerId),
    releaseId
      ? db.from("tracks").select("id,title,audio_url,is_primary").eq("owner_id", ownerId).eq("release_id", releaseId).order("is_primary", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    contentItemId
      ? stemDb.from("content_items")
          .select("id,title,platform,format,hook_text,production_notes,audio_scene_id")
          .eq("id", contentItemId)
          .eq("owner_id", ownerId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const firstError = [releaseResult, brandResult, assetResult, linkResult, tracksResult, contentResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const release = releaseResult.data;
  const assets = (assetResult.data ?? []) as MediaAsset[];
  const links = (linkResult.data ?? []) as MediaLink[];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const brand = new Map((brandResult.data ?? []).map((row) => [row.section, textFromBrandContent(row.content)]));
  const trackIds = new Set((tracksResult.data ?? []).map((track) => track.id));

  const relevantLinks = links.filter((link) =>
    Boolean(
      (releaseId && link.release_id === releaseId) ||
      (contentItemId && link.content_item_id === contentItemId) ||
      (link.track_id && trackIds.has(link.track_id)),
    ),
  );
  const linkedByAsset = new Map<string, MediaLink>();
  for (const link of relevantLinks) {
    const current = linkedByAsset.get(link.media_asset_id);
    if (!current || (!current.is_primary && link.is_primary)) linkedByAsset.set(link.media_asset_id, link);
  }

  const candidates: CreativeReference[] = [];
  for (const asset of assets) {
    const url = httpUrl(asset.public_url);
    if (!url) continue;
    const kind = mediaKind(asset.mime_type);
    if (kind !== "image" && kind !== "video") continue;
    const link = linkedByAsset.get(asset.id);
    const source = sourceForAsset(asset, link, releaseId, contentItemId);
    if (!source) continue;
    const metadata = mediaMetadata(asset);
    candidates.push({
      assetId: asset.id,
      url,
      kind,
      role: link?.role || asset.asset_type,
      source,
      title: metadata.title,
      reason: referenceReason(link, asset, source),
      score: referenceScore(link, asset, source),
      isPrimary: Boolean(link?.is_primary),
    });
  }

  const artworkUrl = httpUrl(release?.artwork_url);
  if (artworkUrl) {
    candidates.push({
      assetId: null,
      url: artworkUrl,
      kind: "image",
      role: "cover",
      source: "release",
      title: `${release?.title || "Release"} artwork`,
      reason: "Canonical release artwork. It must remain the dominant visual lineage anchor.",
      score: 140,
      isPrimary: true,
    });
  }

  const identityAssets = dedupeAndLimit(
    candidates.filter((reference) => reference.source === "brand" || reference.source === "approved_library"),
    8,
  );
  const imageReferences = dedupeAndLimit(
    candidates.filter((reference) => reference.kind === "image" && reference.role !== "brand_logo"),
    5,
  );
  const videoReferences = dedupeAndLimit(
    candidates.filter((reference) => reference.kind === "video"),
    2,
  );

  const linkedMaster = relevantLinks
    .filter((link) => link.role === "master_audio" || link.role === "audio_preview")
    .map((link) => assetById.get(link.media_asset_id))
    .find((asset) => httpUrl(asset?.public_url));
  const primaryTrack = (tracksResult.data ?? []).find((track) => track.is_primary) ?? tracksResult.data?.[0];
  const canonicalAudioUrl = httpUrl(linkedMaster?.public_url) || httpUrl(primaryTrack?.audio_url);

  let audioScenes: CreativeAudioSceneReference[] = [];
  let selectedAudioScene: CreativeAudioSceneReference | null = null;
  if (primaryTrack?.id) {
    const sceneResult = await stemDb.from("audio_scenes")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("track_id", primaryTrack.id)
      .eq("status", "ready")
      .order("is_pinned", { ascending: false })
      .order("score", { ascending: false, nullsFirst: false });
    if (sceneResult.error) throw new Error(sceneResult.error.message);
    const scenes = (sceneResult.data ?? []) as AudioScene[];
    const content = contentResult.data;
    const contextText = [
      content?.title,
      content?.format,
      content?.platform,
      content?.hook_text,
      content?.production_notes,
    ].filter((value): value is string => typeof value === "string" && Boolean(value.trim())).join(" ");
    const platform = typeof content?.platform === "string" ? content.platform : "";
    const explicitId = typeof content?.audio_scene_id === "string" ? content.audio_scene_id : null;
    const ranked = scenes
      .map((scene) => ({ scene, fit: sceneFit(scene, contextText, platform) }))
      .sort((a, b) => b.fit - a.fit);
    const selected = (explicitId ? ranked.find((candidate) => candidate.scene.id === explicitId) : null) ?? ranked[0] ?? null;
    audioScenes = ranked.slice(0, 8).map(({ scene, fit }) => {
      const preview = scene.preview_asset_id ? assetById.get(scene.preview_asset_id) : null;
      const reason = explicitId === scene.id
        ? "Artist-selected Audio Scene for this content item."
        : `Atlas content-fit score ${Math.round(fit)} based on the brief, format, platform and musical intent.`;
      return toAudioSceneReference(scene, httpUrl(preview?.public_url), reason);
    });
    if (selected) {
      selectedAudioScene = audioScenes.find((scene) => scene.id === selected.scene.id)
        ?? toAudioSceneReference(selected.scene, null, `Atlas content-fit score ${Math.round(selected.fit)}.`);
    }
  }

  const audioReferenceUrl = selectedAudioScene?.previewUrl || canonicalAudioUrl;
  const visualDirection = release?.visual_direction?.trim() || "";
  const colorPalette = Array.isArray(release?.color_palette)
    ? release.color_palette.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const visualWorld = brand.get("Visual world") || "Warm electronic glow, elegant technology, sensual afterhours energy, analog warmth, movement, and restrained futurism.";
  const visualExclusions = brand.get("Visual exclusions") || "Cheap cyberpunk, generic sci-fi, robotic clichés, faceless stock-like characters, neon overload, and obvious AI gimmicks.";
  const promptTemplate = brand.get("Visual prompt templates") || "";
  const continuityRules = brand.get("Visual continuity rules") || "Treat approved Atlas Irwin references as art-direction evidence. New work should extend the same visual DNA rather than inventing a new identity for every post.";
  const cohesionScore = Math.min(
    100,
    35 +
      (artworkUrl ? 28 : 0) +
      (identityAssets.length ? 17 : 0) +
      (visualDirection ? 12 : 0) +
      (colorPalette.length ? 8 : 0),
  );

  return {
    release: {
      id: release?.id ?? null,
      title: release?.title || "Atlas Irwin",
      artworkUrl,
      visualDirection,
      colorPalette,
    },
    brand: { visualWorld, visualExclusions, promptTemplate, continuityRules },
    imageReferences,
    videoReferences,
    identityAssets,
    audioReferenceUrl,
    audioScenes,
    selectedAudioScene,
    cohesionScore,
    referenceSummary: summarizeReferences(imageReferences, videoReferences, artworkUrl, selectedAudioScene),
  };
}

export function buildCohesiveVisualPrompt(input: {
  context: CreativeReferenceContext;
  contentTitle: string;
  platform: string;
  format: string;
  creativeBrief: string;
  hook?: string | null;
  outputKind: "image" | "video";
}) {
  const { context } = input;
  const referenceManifest = context.imageReferences
    .map((reference, index) => `Image reference ${index + 1}: ${reference.title} (${reference.role}). ${reference.reason}`)
    .join("\n");
  const motionManifest = context.videoReferences
    .map((reference, index) => `Motion reference ${index + 1}: ${reference.title}. ${reference.reason}`)
    .join("\n");
  const palette = context.release.colorPalette.length ? context.release.colorPalette.join(", ") : "derive the palette from the supplied artwork and brand references";
  const outputRule = input.outputKind === "video"
    ? "Create a short, editorial music visual with believable motion, intentional camera behavior, tactile detail, and no fake crowd or stock-footage feeling. The motion should feel directed rather than generated."
    : "Create an editorial campaign image with intentional composition, believable material detail, restrained retouching, and a finish that could plausibly come from a professional art director and photographer/designer.";
  const audioScene = context.selectedAudioScene;
  const audioDirection = audioScene
    ? [
        `Selected musical treatment: ${audioScene.name} (${audioScene.type.replaceAll("_", " ")}).`,
        audioScene.startMs !== null && audioScene.endMs !== null
          ? `Primary musical window: ${(audioScene.startMs / 1000).toFixed(1)}s to ${(audioScene.endMs / 1000).toFixed(1)}s.`
          : "",
        `Musical intent: ${audioScene.description}`,
        "For video, let shot density, movement, reveals and transitions follow this treatment. Do not simply put unrelated motion over the track. For a progressive reveal, visually add complexity as musical layers enter; for a vocal spotlight, simplify the frame and protect lyrical focus; for groove, make motion feel rhythm-led; for vocal-to-drop or full-impact, reserve the strongest visual change for the payoff.",
      ].filter(Boolean).join("\n")
    : "No derived Audio Scene is selected. Use the canonical master and Track Intelligence timing as the musical reference.";

  return [
    `Create one ${input.outputKind} asset for Atlas Irwin: ${input.contentTitle}.`,
    `Destination: ${input.platform} / ${input.format}.`,
    "NON-NEGOTIABLE VISUAL LINEAGE:",
    context.release.artworkUrl
      ? "The supplied release artwork is the primary art-direction anchor. The result must visibly belong to the exact same release world. Preserve recognisable palette, material, geometry, lighting logic and signature motifs. When composition allows, include the artwork as a recognisable intentional object or graphic element rather than replacing it with unrelated AI imagery."
      : "No release artwork is available, so rely more heavily on the approved Atlas Irwin brand references and visual rules.",
    `Atlas Irwin visual world: ${context.brand.visualWorld}`,
    context.release.visualDirection ? `Release-specific visual direction: ${context.release.visualDirection}` : "",
    `Palette: ${palette}.`,
    context.brand.promptTemplate ? `Reusable Atlas prompt language: ${context.brand.promptTemplate}` : "",
    `Continuity rule: ${context.brand.continuityRules}`,
    referenceManifest,
    motionManifest,
    "MUSICAL DIRECTION:",
    audioDirection,
    "REFERENCE HANDLING:",
    "Use the supplied references as concrete art-direction evidence, not as loose inspiration. Do not average them into generic cyberpunk. Do not make a collage unless the brief explicitly asks for one. Do not redraw or approximate the Atlas Irwin logo. If an exact logo treatment is required, leave clean composition space for deterministic placement later.",
    "HUMAN-MADE QUALITY BAR:",
    "Avoid glossy AI perfection, plastic skin/materials, impossible micro-detail, over-symmetry, random decorative objects, meaningless pseudo-typography, generic neon city scenes, stock-looking people, excessive lens flare, and visual motifs unrelated to the release. Prefer one strong idea, real-world imperfection, controlled negative space, tactile surfaces, coherent lighting and editorial restraint.",
    `Avoid: ${context.brand.visualExclusions}`,
    `Creative brief: ${input.creativeBrief || input.hook || input.contentTitle}`,
    input.hook ? `Marketing hook for context only, do not automatically render it as text: ${input.hook}` : "",
    outputRule,
    "Do not add readable text unless the creative brief explicitly requires typography. The final asset should feel authored, specific and recognisably Atlas Irwin, not like a prompt demo.",
  ].filter(Boolean).join("\n\n");
}
