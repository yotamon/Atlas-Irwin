import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mediaKind, mediaMetadata } from "@/lib/studio/media";
import type { ArtistScopedMusicDatabase } from "@/types/artist-scoped-music-database";
import type { CreativeAssetProfile, CreativeMemoryDatabase, CreativeMemoryEvent, CreativeMemoryEventType } from "@/types/creative-memory-database";
import type { Database, Json, MediaAsset } from "@/types/database";
import { performanceEvidenceScore, scoreCreativeAsset, summarizeCreativeMemory, type CreativeMemoryPreferenceSummary } from "./domain";

type DatabaseClient = SupabaseClient<Database>;

type CreativeMemoryRecordInput = {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  eventType: CreativeMemoryEventType;
  idempotencyKey: string;
  sentiment?: -1 | 0 | 1;
  weight?: number;
  signal?: string | null;
  source?: string;
  assetId?: string | null;
  releaseId?: string | null;
  trackId?: string | null;
  momentId?: string | null;
  videoProjectId?: string | null;
  context?: Json;
};

export type CreativeMemoryRecommendation = {
  assetId: string;
  url: string;
  title: string;
  kind: "image" | "video";
  role: string;
  score: number;
  reasons: string[];
  visualDescriptors: string[];
  semanticDescriptors: string[];
  approvals: number;
  rejections: number;
  uses: number;
  performanceScore: number | null;
  brandRelevance: number;
  excluded: boolean;
  exclusionReason: string | null;
  duplicateOfAssetId: string | null;
};

export type ArtistCreativeMemory = {
  preferences: CreativeMemoryPreferenceSummary;
  recommendations: CreativeMemoryRecommendation[];
  excluded: CreativeMemoryRecommendation[];
  eventCount: number;
};

function asMemory(client: DatabaseClient) {
  return client as unknown as SupabaseClient<CreativeMemoryDatabase>;
}

function asMusic(client: DatabaseClient) {
  return client as unknown as SupabaseClient<ArtistScopedMusicDatabase>;
}

function record(value: Json | unknown): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stringArray(value: Json | unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 30) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].slice(0, limit);
}

function clamp01(value: number | null | undefined, fallback = 0.5) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? Math.max(0, Math.min(1, normalized)) : fallback;
}

function eventCounts(events: CreativeMemoryEvent[]) {
  let approvals = 0;
  let rejections = 0;
  let uses = 0;
  let exports = 0;
  for (const event of events) {
    if (event.event_type === "reference_approved" || event.event_type === "shot_locked") approvals += 1;
    if (event.event_type === "reference_rejected" || event.event_type === "shot_rejected" || event.event_type === "shot_replaced") rejections += 1;
    if (event.event_type === "asset_used" || event.event_type === "shot_locked") uses += 1;
    if (event.event_type === "asset_exported") exports += 1;
  }
  return { approvals, rejections, uses, exports };
}

function baseRoleScore(role: string, assetType: string, primary: boolean) {
  const normalized = role || assetType;
  let score = 44;
  if (normalized === "cover") score = 92;
  else if (normalized === "alternate_artwork") score = 78;
  else if (normalized === "brand_reference") score = 76;
  else if (normalized === "brand_motion_reference") score = 74;
  else if (normalized === "shot_final") score = 68;
  else if (normalized === "music_video_master") score = 64;
  else if (normalized === "video_reference") score = 62;
  else if (normalized === "social_cut") score = 58;
  else if (normalized === "content_video") score = 56;
  else if (normalized === "social_image") score = 54;
  else if (normalized === "press_image") score = 52;
  else if (normalized === "storyboard_frame" || normalized === "thumbnail") score = 46;
  if (primary) score += 12;
  return score;
}

function profileDescriptors(profile: CreativeAssetProfile | undefined, asset: MediaAsset) {
  const metadata = mediaMetadata(asset);
  const raw = record(asset.metadata);
  const visual = uniqueStrings([
    ...(profile?.visual_descriptors ?? []),
    ...stringArray(raw.visual_descriptors),
    ...metadata.tags,
  ], 24);
  const semantic = uniqueStrings([
    ...(profile?.semantic_descriptors ?? []),
    ...stringArray(raw.semantic_descriptors),
    metadata.description,
    metadata.title,
  ], 24);
  return { visual, semantic };
}

function perceptualKey(asset: MediaAsset, profile: CreativeAssetProfile | undefined) {
  if (profile?.duplicate_of_asset_id) return `declared:${profile.duplicate_of_asset_id}`;
  if (asset.content_hash) return `hash:${asset.content_hash}`;
  const metadata = record(asset.metadata);
  const perceptual = typeof metadata.perceptual_hash === "string" ? metadata.perceptual_hash.trim() : "";
  return perceptual ? `phash:${perceptual}` : null;
}

export async function recordCreativeMemoryEvent(input: CreativeMemoryRecordInput) {
  const key = input.idempotencyKey.trim().slice(0, 240);
  if (!key) throw new Error("Creative Memory event requires an idempotency key.");
  const db = asMemory(input.db);
  const payload = {
    owner_id: input.ownerId,
    artist_id: input.artistId,
    asset_id: input.assetId ?? null,
    release_id: input.releaseId ?? null,
    track_id: input.trackId ?? null,
    moment_id: input.momentId ?? null,
    video_project_id: input.videoProjectId ?? null,
    event_type: input.eventType,
    sentiment: input.sentiment ?? 0,
    weight: Math.max(0.1, Math.min(5, Number(input.weight ?? 1))),
    signal: input.signal?.trim().slice(0, 500) || null,
    source: (input.source || "ensemblis").trim().slice(0, 80),
    idempotency_key: key,
    context: input.context ?? {},
  };
  const { data, error } = await db.from("creative_memory_events")
    .upsert(payload, { onConflict: "owner_id,artist_id,idempotency_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertCreativeAssetProfile(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  assetId: string;
  visualDescriptors?: string[];
  semanticDescriptors?: string[];
  brandRelevance?: number;
  excluded?: boolean;
  exclusionReason?: string | null;
  duplicateOfAssetId?: string | null;
  duplicateEvidence?: Json;
  evidence?: Json;
  reviewed?: boolean;
}) {
  const db = asMemory(input.db);
  const { data: existing, error: readError } = await db.from("creative_asset_profiles")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("asset_id", input.assetId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  const now = new Date().toISOString();
  const payload = {
    owner_id: input.ownerId,
    artist_id: input.artistId,
    asset_id: input.assetId,
    visual_descriptors: uniqueStrings([...(existing?.visual_descriptors ?? []), ...(input.visualDescriptors ?? [])]),
    semantic_descriptors: uniqueStrings([...(existing?.semantic_descriptors ?? []), ...(input.semanticDescriptors ?? [])]),
    brand_relevance: clamp01(input.brandRelevance, existing?.brand_relevance ?? 0.5),
    excluded: input.excluded ?? existing?.excluded ?? false,
    exclusion_reason: input.exclusionReason !== undefined ? input.exclusionReason?.trim().slice(0, 1000) || null : existing?.exclusion_reason ?? null,
    duplicate_of_asset_id: input.duplicateOfAssetId !== undefined ? input.duplicateOfAssetId : existing?.duplicate_of_asset_id ?? null,
    duplicate_evidence: input.duplicateEvidence ?? existing?.duplicate_evidence ?? {},
    evidence: input.evidence ?? existing?.evidence ?? {},
    last_reviewed_at: input.reviewed ? now : existing?.last_reviewed_at ?? null,
    updated_at: now,
  };
  const { data, error } = await db.from("creative_asset_profiles")
    .upsert(payload, { onConflict: "owner_id,artist_id,asset_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setCreativeAssetExcluded(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  assetId: string;
  excluded: boolean;
  reason?: string | null;
}) {
  const profile = await upsertCreativeAssetProfile({
    ...input,
    exclusionReason: input.excluded ? input.reason || "Artist excluded this asset from automatic creative recommendations." : null,
    reviewed: true,
  });
  await recordCreativeMemoryEvent({
    db: input.db,
    ownerId: input.ownerId,
    artistId: input.artistId,
    assetId: input.assetId,
    eventType: input.excluded ? "exclusion_added" : "exclusion_removed",
    sentiment: input.excluded ? -1 : 0,
    weight: 5,
    signal: input.reason || (input.excluded ? "Do not recommend this asset" : "Asset restored to recommendations"),
    idempotencyKey: `asset-exclusion:${input.assetId}:${input.excluded}:${profile.updated_at}`,
    context: { reason: input.reason ?? null },
  });
  return profile;
}

async function latestPerformanceByContentItem(db: DatabaseClient, ownerId: string, contentItemIds: string[]) {
  if (!contentItemIds.length) return new Map<string, number>();
  const { data, error } = await db.from("metric_snapshots")
    .select("content_item_id,date,views,reach,likes,comments,shares,saves,follows,link_clicks")
    .eq("owner_id", ownerId)
    .in("content_item_id", contentItemIds)
    .order("date", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const latest = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.content_item_id || latest.has(row.content_item_id)) continue;
    latest.set(row.content_item_id, performanceEvidenceScore({
      views: row.views,
      reach: row.reach,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      saves: row.saves,
      follows: row.follows,
      linkClicks: row.link_clicks,
    }));
  }
  return latest;
}

export async function rankCreativeReferenceAssets(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  releaseId?: string | null;
  trackId?: string | null;
  momentId?: string | null;
  limit?: number;
  includeExcluded?: boolean;
}) {
  const memoryDb = asMemory(input.db);
  const musicDb = asMusic(input.db);
  const [linksResult, profilesResult, eventsResult, assetsResult] = await Promise.all([
    musicDb.from("media_links")
      .select("id,media_asset_id,release_id,track_id,content_item_id,role,is_primary,artist_id")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId),
    memoryDb.from("creative_asset_profiles")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId),
    memoryDb.from("creative_memory_events")
      .select("*")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .order("created_at", { ascending: false })
      .limit(500),
    input.db.from("media_assets")
      .select("*")
      .eq("owner_id", input.ownerId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const firstError = [linksResult.error, profilesResult.error, eventsResult.error, assetsResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const links = linksResult.data ?? [];
  const profiles = (profilesResult.data ?? []) as CreativeAssetProfile[];
  const events = (eventsResult.data ?? []) as CreativeMemoryEvent[];
  const assets = (assetsResult.data ?? []) as MediaAsset[];
  const profileByAsset = new Map(profiles.map((profile) => [profile.asset_id, profile]));
  const eventsByAsset = new Map<string, CreativeMemoryEvent[]>();
  for (const event of events) {
    if (!event.asset_id) continue;
    const bucket = eventsByAsset.get(event.asset_id) ?? [];
    bucket.push(event);
    eventsByAsset.set(event.asset_id, bucket);
  }

  const linksByAsset = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByAsset.get(link.media_asset_id) ?? [];
    bucket.push(link);
    linksByAsset.set(link.media_asset_id, bucket);
  }
  const artistTag = `artist:${input.artistId}`.toLowerCase();
  const candidateAssets = assets.filter((asset) => {
    const kind = mediaKind(asset.mime_type);
    if ((kind !== "image" && kind !== "video") || !asset.public_url) return false;
    if (linksByAsset.has(asset.id) || profileByAsset.has(asset.id)) return true;
    return mediaMetadata(asset).tags.some((tag) => tag.toLowerCase() === artistTag);
  });

  const contentItemIds = [...new Set(links.flatMap((link) => link.content_item_id ? [link.content_item_id] : []))];
  const performanceByContentItem = await latestPerformanceByContentItem(input.db, input.ownerId, contentItemIds);
  const duplicateGroups = new Map<string, string[]>();
  for (const asset of candidateAssets) {
    const key = perceptualKey(asset, profileByAsset.get(asset.id));
    if (!key) continue;
    duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), asset.id]);
  }

  const prelim = candidateAssets.map((asset) => {
    const assetLinks = linksByAsset.get(asset.id) ?? [];
    const assetEvents = eventsByAsset.get(asset.id) ?? [];
    const profile = profileByAsset.get(asset.id);
    const counts = eventCounts(assetEvents);
    const primaryLink = [...assetLinks].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))[0];
    const role = primaryLink?.role || asset.asset_type;
    const contentPerformance = assetLinks
      .flatMap((link) => link.content_item_id ? [performanceByContentItem.get(link.content_item_id)] : [])
      .filter((score): score is number => typeof score === "number");
    const performanceScore = contentPerformance.length ? Math.max(...contentPerformance) : null;
    const sameRelease = Boolean(input.releaseId && assetLinks.some((link) => link.release_id === input.releaseId));
    const sameTrack = Boolean(input.trackId && assetLinks.some((link) => link.track_id === input.trackId));
    const sameMoment = Boolean(input.momentId && assetEvents.some((event) => event.moment_id === input.momentId));
    const descriptors = profileDescriptors(profile, asset);
    return {
      asset,
      assetLinks,
      assetEvents,
      profile,
      counts,
      primaryLink,
      role,
      performanceScore,
      sameRelease,
      sameTrack,
      sameMoment,
      descriptors,
      baseScore: baseRoleScore(role, asset.asset_type, Boolean(primaryLink?.is_primary)),
    };
  });

  const canonicalByGroup = new Map<string, string>();
  for (const [key, ids] of duplicateGroups) {
    if (ids.length < 2) continue;
    const ranked = prelim
      .filter((item) => ids.includes(item.asset.id))
      .sort((a, b) => b.counts.approvals - a.counts.approvals || a.counts.rejections - b.counts.rejections || b.baseScore - a.baseScore || a.asset.created_at.localeCompare(b.asset.created_at));
    if (ranked[0]) canonicalByGroup.set(key, ranked[0].asset.id);
  }

  const recommendations = prelim.map((item): CreativeMemoryRecommendation => {
    const duplicateKey = perceptualKey(item.asset, item.profile);
    const canonical = duplicateKey ? canonicalByGroup.get(duplicateKey) : null;
    const duplicateOfAssetId = item.profile?.duplicate_of_asset_id ?? (canonical && canonical !== item.asset.id ? canonical : null);
    const score = scoreCreativeAsset({
      baseScore: item.baseScore,
      approvals: item.counts.approvals,
      rejections: item.counts.rejections,
      uses: item.counts.uses + item.assetLinks.length,
      exports: item.counts.exports,
      performanceScore: item.performanceScore,
      brandRelevance: clamp01(item.profile?.brand_relevance, 0.5),
      sameRelease: item.sameRelease,
      sameTrack: item.sameTrack,
      sameMoment: item.sameMoment,
      excluded: item.profile?.excluded ?? false,
      duplicate: Boolean(duplicateOfAssetId),
    });
    const metadata = mediaMetadata(item.asset);
    const relationshipReason = item.sameTrack
      ? "Track-linked source"
      : item.sameRelease
        ? "Release-linked source"
        : item.primaryLink?.role === "brand_reference" || item.primaryLink?.role === "brand_motion_reference"
          ? "Artist brand reference"
          : "Artist library source";
    return {
      assetId: item.asset.id,
      url: item.asset.public_url as string,
      title: metadata.title,
      kind: mediaKind(item.asset.mime_type) as "image" | "video",
      role: item.role,
      score: score.score,
      reasons: uniqueStrings([relationshipReason, ...score.reasons], 5),
      visualDescriptors: item.descriptors.visual,
      semanticDescriptors: item.descriptors.semantic,
      approvals: item.counts.approvals,
      rejections: item.counts.rejections,
      uses: item.counts.uses + item.assetLinks.length,
      performanceScore: item.performanceScore,
      brandRelevance: clamp01(item.profile?.brand_relevance, 0.5),
      excluded: score.excluded,
      exclusionReason: item.profile?.exclusion_reason ?? null,
      duplicateOfAssetId,
    };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return {
    preferences: summarizeCreativeMemory(events),
    recommendations: recommendations.filter((item) => !item.excluded).slice(0, input.limit ?? 8),
    excluded: input.includeExcluded ? recommendations.filter((item) => item.excluded) : [],
    eventCount: events.length,
  } satisfies ArtistCreativeMemory;
}

export async function loadArtistCreativeMemory(input: {
  db: DatabaseClient;
  ownerId: string;
  artistId: string;
  releaseId?: string | null;
  trackId?: string | null;
  momentId?: string | null;
  recommendationLimit?: number;
}) {
  return rankCreativeReferenceAssets({
    ...input,
    limit: input.recommendationLimit ?? 8,
    includeExcluded: true,
  });
}
