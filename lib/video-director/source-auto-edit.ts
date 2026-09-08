import type { MediaAsset } from "@/types/database";
import type { ExtendedMusicVideoShot } from "@/types/video-database";

export type SourceAssetContext = {
  asset: MediaAsset;
  roles: string[];
};

export type SourceAssemblySuggestion = {
  shotId: string;
  assetId: string;
  sourceOffsetMs: number;
  confidence: number;
  score: number;
  reason: string;
  roles: string[];
};

export type SourceAssemblyPlan = {
  version: "source-assembly-v1";
  suggestions: SourceAssemblySuggestion[];
  unresolvedShotIds: string[];
  generatedShotsAvoided: number;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizedWords(value: string) {
  return new Set(value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((word) => word.length >= 4));
}

function overlapScore(a: string, b: string) {
  const left = normalizedWords(a);
  const right = normalizedWords(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(1, Math.min(left.size, right.size));
}

function assetSemanticText(context: SourceAssetContext) {
  const metadata = record(context.asset.metadata);
  return [
    context.asset.asset_type,
    context.asset.mime_type ?? "",
    context.asset.storage_path,
    ...context.roles,
    typeof metadata.title === "string" ? metadata.title : "",
    typeof metadata.description === "string" ? metadata.description : "",
    typeof metadata.filename === "string" ? metadata.filename : "",
    typeof metadata.source_kind === "string" ? metadata.source_kind : "",
    ...strings(metadata.tags),
  ].join(" ");
}

function isVisual(asset: MediaAsset) {
  const mime = asset.mime_type?.toLowerCase() ?? "";
  const type = asset.asset_type.toLowerCase();
  return mime.startsWith("video/") || mime.startsWith("image/") || /video|image|photo|artwork|cover|thumbnail/.test(type);
}

function isVideo(asset: MediaAsset) {
  return Boolean(asset.mime_type?.toLowerCase().startsWith("video/")) || /video|footage|clip/.test(asset.asset_type.toLowerCase());
}

function isLikelyGenerated(context: SourceAssetContext) {
  const text = assetSemanticText(context).toLowerCase();
  const metadata = record(context.asset.metadata);
  return metadata.ai_generated === true || metadata.generated === true || /atlas-generated|ai-generated|generation[_ -]?run|video[_ -]?generation|higgsfield/.test(text);
}

function preferredOffsetMs(context: SourceAssetContext, shotDurationMs: number) {
  const metadata = record(context.asset.metadata);
  const raw = [metadata.preferred_start_ms, metadata.source_offset_ms, metadata.in_ms]
    .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  const duration = context.asset.duration_ms ?? 0;
  const requested = raw ?? 0;
  return duration > shotDurationMs ? Math.min(requested, Math.max(0, duration - shotDurationMs)) : 0;
}

function roleBoost(shot: ExtendedMusicVideoShot, roles: string[]) {
  const joined = roles.join(" ").toLowerCase();
  if (shot.shot_type === "performance" && /performance|live|rehearsal|artist|portrait|video/.test(joined)) return 22;
  if (shot.shot_type === "graphic" && /artwork|cover|visual|graphic|brand/.test(joined)) return 20;
  if (/b[-_ ]?roll|footage|performance|live|video/.test(joined)) return 14;
  if (/cover|artwork|alternate_artwork/.test(joined)) return 8;
  return 0;
}

function durationScore(asset: MediaAsset, shotDurationMs: number) {
  if (!isVideo(asset)) return shotDurationMs <= 4000 ? 3 : -5;
  if (!asset.duration_ms) return 2;
  if (asset.duration_ms >= shotDurationMs) return 12;
  return Math.max(-16, -Math.round((shotDurationMs - asset.duration_ms) / 1000) * 3);
}

function aspectScore(asset: MediaAsset, targetAspectRatio: string) {
  if (!asset.width || !asset.height) return 0;
  const actual = asset.width / asset.height;
  const target = targetAspectRatio === "9:16" ? 9 / 16 : targetAspectRatio === "1:1" ? 1 : 16 / 9;
  const delta = Math.abs(Math.log(actual / target));
  if (delta < 0.12) return 8;
  if (delta < 0.4) return 3;
  return -4;
}

function scoreAsset(input: {
  shot: ExtendedMusicVideoShot;
  context: SourceAssetContext;
  targetAspectRatio: string;
  previousAssetId: string | null;
  usageCount: number;
}) {
  const { shot, context } = input;
  const durationMs = Math.max(250, shot.end_ms - shot.start_ms);
  const semantic = assetSemanticText(context);
  const intent = `${shot.description} ${shot.prompt ?? ""}`;
  let score = 25;
  const reasons: string[] = [];

  if (isVideo(context.asset)) {
    score += 14;
    reasons.push("real video source");
  } else {
    reasons.push("visual source");
  }

  const role = roleBoost(shot, context.roles);
  if (role) {
    score += role;
    reasons.push("role matches shot intent");
  }

  const semanticMatch = overlapScore(intent, semantic);
  if (semanticMatch > 0) {
    score += Math.round(semanticMatch * 24);
    reasons.push("metadata matches editorial intent");
  }

  const duration = durationScore(context.asset, durationMs);
  score += duration;
  if (duration >= 8) reasons.push("duration covers the shot");

  score += aspectScore(context.asset, input.targetAspectRatio);

  if (isLikelyGenerated(context)) {
    score -= 24;
    reasons.push("generated provenance penalized while source media exists");
  }
  if (input.previousAssetId === context.asset.id) score -= 18;
  score -= Math.min(24, input.usageCount * 9);

  if (shot.shot_type === "performance" && !isVideo(context.asset)) score -= 28;
  if (shot.shot_type === "graphic" && isVideo(context.asset)) score -= 5;

  return {
    score,
    reasons,
    sourceOffsetMs: preferredOffsetMs(context, durationMs),
  };
}

export function buildSourceAssemblyPlan(input: {
  shots: ExtendedMusicVideoShot[];
  assets: SourceAssetContext[];
  targetAspectRatio: string;
  includeLocked?: boolean;
}): SourceAssemblyPlan {
  const candidates = input.assets.filter(({ asset }) => asset.public_url && isVisual(asset));
  const usage = new Map<string, number>();
  const suggestions: SourceAssemblySuggestion[] = [];
  const unresolvedShotIds: string[] = [];
  let previousAssetId: string | null = null;

  for (const shot of [...input.shots].sort((a, b) => a.start_ms - b.start_ms || a.display_order - b.display_order)) {
    if (!input.includeLocked && shot.selected_asset_id) {
      previousAssetId = shot.selected_asset_id;
      usage.set(shot.selected_asset_id, (usage.get(shot.selected_asset_id) ?? 0) + 1);
      continue;
    }
    if (!["generated", "performance", "source_media", "graphic", "hold"].includes(shot.shot_type)) continue;

    const ranked = candidates.map((context) => ({
      context,
      ...scoreAsset({
        shot,
        context,
        targetAspectRatio: input.targetAspectRatio,
        previousAssetId,
        usageCount: usage.get(context.asset.id) ?? 0,
      }),
    })).sort((a, b) => b.score - a.score || a.context.asset.id.localeCompare(b.context.asset.id));

    const winner = ranked[0];
    if (!winner || winner.score < 24) {
      unresolvedShotIds.push(shot.id);
      continue;
    }

    const runnerUp = ranked[1]?.score ?? 0;
    const confidence = Math.max(0.35, Math.min(0.96, 0.58 + (winner.score - runnerUp) / 100 + Math.max(0, winner.score - 35) / 180));
    suggestions.push({
      shotId: shot.id,
      assetId: winner.context.asset.id,
      sourceOffsetMs: winner.sourceOffsetMs,
      confidence,
      score: winner.score,
      reason: winner.reasons.slice(0, 3).join(" · ") || "best deterministic source match",
      roles: winner.context.roles,
    });
    previousAssetId = winner.context.asset.id;
    usage.set(winner.context.asset.id, (usage.get(winner.context.asset.id) ?? 0) + 1);
  }

  return {
    version: "source-assembly-v1",
    suggestions,
    unresolvedShotIds,
    generatedShotsAvoided: suggestions.filter((suggestion) => {
      const shot = input.shots.find((item) => item.id === suggestion.shotId);
      return shot?.shot_type === "generated";
    }).length,
  };
}
