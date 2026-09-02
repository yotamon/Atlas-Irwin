import type { TrackLyricsContext } from "@/lib/lyrics-intelligence/context";
import type { MusicHookCandidate, MusicMap, MusicMapSection } from "@/lib/video-director/creative-director";
import type { AudioScene, TrackStem } from "@/types/stem-database";

export type CreativeGraphProvenance = "master" | "lyrics" | "stem" | "audio_scene" | "derived";

export type CreativeGraphHighlight = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  score: number;
  dominantKind: string;
  kinds: string[];
  hookIds: string[];
  lyricMomentIds: string[];
  audioSceneIds: string[];
  stemRoles: string[];
  rationale: string[];
  provenance: CreativeGraphProvenance[];
};

export type CreativeGraphSection = {
  id: string;
  label: string;
  type: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
  energy: number;
  lyricSectionKeys: string[];
  lyricMomentIds: string[];
  audioSceneIds: string[];
  hookIds: string[];
  activeStemRoles: string[];
};

export type TrackCreativeIntelligenceGraph = {
  version: 1;
  durationMs: number;
  bpm: number | null;
  highlights: CreativeGraphHighlight[];
  sections: CreativeGraphSection[];
  confidence: {
    masterOverall: number | null;
    masterStructure: number | null;
    lyricSectionTimingCoverage: number;
    lyricMomentTimingCoverage: number;
    stemTimelineConfidence: number | null;
    audioScenePreviewCoverage: number;
  };
  provenance: {
    musicAnalysisVersion: number | null;
    lyricsVersion: number | null;
    stemAnalysisVersions: number[];
    audioSceneRecipeVersions: number[];
  };
};

type WindowSeed = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  score: number;
  kind: string;
  hookId?: string;
  lyricMomentId?: string;
  audioSceneId?: string;
  stemRoles?: string[];
  rationale?: string[];
  provenance: CreativeGraphProvenance;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numeric(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function overlapMs(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));
}

function overlapRatio(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) {
  return overlapMs(a, b) / Math.max(1, Math.min(a.endMs - a.startMs, b.endMs - b.startMs));
}

function stemTimelineConfidence(stem: TrackStem) {
  const alignment = record(stem.alignment);
  const analysisAlignment = record(record(stem.analysis).alignment);
  return clamp01(
    numeric(alignment.timeline_confidence,
      numeric(analysisAlignment.timeline_confidence,
        stem.alignment_confidence ?? 0)),
  );
}

function stemActiveInWindow(stem: TrackStem, startMs: number, endMs: number) {
  const analysis = record(stem.analysis);
  const activity = Array.isArray(analysis.activity_curve) ? analysis.activity_curve : [];
  if (activity.length) {
    const rows = activity.map(record).filter((row) => {
      const start = numeric(row.start_ms, -1);
      const end = numeric(row.end_ms, -1);
      return end > startMs && start < endMs;
    });
    if (rows.length) {
      const active = rows.reduce((sum, row) => sum + (row.active === true ? 1 : 0), 0) / rows.length;
      const energy = rows.reduce((sum, row) => sum + numeric(row.energy), 0) / rows.length;
      return active >= 0.22 || energy >= 0.26;
    }
  }
  const sections = Array.isArray(analysis.section_activity) ? analysis.section_activity : [];
  return sections.map(record).some((row) => {
    const start = numeric(row.start_ms, -1);
    const end = numeric(row.end_ms, -1);
    if (end <= startMs || start >= endMs) return false;
    return numeric(row.active_ratio) >= 0.18 || numeric(row.energy) >= 0.26;
  });
}

function activeStemRoles(stems: TrackStem[], startMs: number, endMs: number) {
  return [...new Set(stems
    .filter((stem) => stem.status === "ready" && stemActiveInWindow(stem, startMs, endMs))
    .map((stem) => stem.category))];
}

function hookReasons(hook: MusicHookCandidate) {
  return Array.isArray(hook.reasons) ? hook.reasons.slice(0, 3) : [];
}

function seedsFromMaster(map: MusicMap): WindowSeed[] {
  return (map.hook_candidates ?? []).map((hook) => ({
    id: `hook:${hook.id}`,
    title: hook.label,
    startMs: hook.start_ms,
    endMs: hook.end_ms,
    score: clamp01(hook.score),
    kind: hook.kind || "musical_hook",
    hookId: hook.id,
    rationale: hookReasons(hook),
    provenance: "master" as const,
  }));
}

function seedsFromLyrics(lyrics: TrackLyricsContext): WindowSeed[] {
  return lyrics.moments
    .filter((moment) => moment.startMs !== null && moment.endMs !== null && moment.endMs > moment.startMs)
    .map((moment) => ({
      id: `lyric:${moment.id}`,
      title: moment.title,
      startMs: moment.startMs!,
      endMs: moment.endMs!,
      score: clamp01(moment.score),
      kind: moment.purposeTags[0] || "lyric_moment",
      lyricMomentId: moment.id,
      rationale: [moment.interpretation, ...moment.visualDirections.slice(0, 1)].filter(Boolean),
      provenance: "lyrics" as const,
    }));
}

function seedsFromScenes(scenes: AudioScene[]): WindowSeed[] {
  return scenes
    .filter((scene) => scene.status === "ready" && scene.recommended_start_ms !== null && scene.recommended_end_ms !== null && scene.recommended_end_ms > scene.recommended_start_ms)
    .map((scene) => ({
      id: `scene:${scene.id}`,
      title: scene.name,
      startMs: scene.recommended_start_ms!,
      endMs: scene.recommended_end_ms!,
      score: clamp01(scene.score ?? 0.5),
      kind: scene.scene_type,
      audioSceneId: scene.id,
      rationale: [scene.description || "", typeof record(scene.rationale).reason === "string" ? record(scene.rationale).reason as string : ""].filter(Boolean),
      provenance: "audio_scene" as const,
    }));
}

function clusterSeeds(seeds: WindowSeed[], stems: TrackStem[]): CreativeGraphHighlight[] {
  const ordered = [...seeds].sort((a, b) => b.score - a.score || a.startMs - b.startMs);
  const clusters: WindowSeed[][] = [];
  for (const seed of ordered) {
    const target = clusters.find((cluster) => cluster.some((existing) =>
      overlapRatio(seed, existing) >= 0.52
      || (Math.abs(seed.startMs - existing.startMs) <= 1800 && Math.abs(seed.endMs - existing.endMs) <= 3500),
    ));
    if (target) target.push(seed);
    else clusters.push([seed]);
  }

  const merged = clusters.map((cluster, index) => {
    const scoreWeight = cluster.reduce((sum, seed) => sum + Math.max(0.15, seed.score), 0);
    const startMs = Math.round(cluster.reduce((sum, seed) => sum + seed.startMs * Math.max(0.15, seed.score), 0) / scoreWeight);
    const endMs = Math.round(cluster.reduce((sum, seed) => sum + seed.endMs * Math.max(0.15, seed.score), 0) / scoreWeight);
    const kinds = [...new Set(cluster.map((seed) => seed.kind))];
    const sourceKinds = new Set(cluster.map((seed) => seed.provenance));
    const multimodalBonus = Math.min(0.18, Math.max(0, sourceKinds.size - 1) * 0.065);
    const top = [...cluster].sort((a, b) => b.score - a.score)[0];
    const meanTop = [...cluster].sort((a, b) => b.score - a.score).slice(0, 3)
      .reduce((sum, seed) => sum + seed.score, 0) / Math.min(3, cluster.length);
    const roles = activeStemRoles(stems, startMs, endMs);
    const stemBonus = Math.min(0.1, roles.length * 0.015);
    return {
      id: `creative-highlight-${index + 1}`,
      title: top.title,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
      score: clamp01(meanTop + multimodalBonus + stemBonus),
      dominantKind: top.kind,
      kinds,
      hookIds: [...new Set(cluster.flatMap((seed) => seed.hookId ? [seed.hookId] : []))],
      lyricMomentIds: [...new Set(cluster.flatMap((seed) => seed.lyricMomentId ? [seed.lyricMomentId] : []))],
      audioSceneIds: [...new Set(cluster.flatMap((seed) => seed.audioSceneId ? [seed.audioSceneId] : []))],
      stemRoles: roles,
      rationale: [...new Set(cluster.flatMap((seed) => seed.rationale ?? []))].slice(0, 5),
      provenance: [...sourceKinds, ...(roles.length ? ["stem" as const] : []), "derived" as const],
    } satisfies CreativeGraphHighlight;
  }).sort((a, b) => b.score - a.score || a.startMs - b.startMs);

  // Diversity is a first-class requirement: do not let many near-identical chorus windows
  // consume the whole downstream creative context.
  const selected: CreativeGraphHighlight[] = [];
  const kindCounts = new Map<string, number>();
  const thirdCounts = new Map<number, number>();
  const durationMs = Math.max(1, ...merged.map((item) => item.endMs));
  for (const candidate of merged) {
    const kindCount = kindCounts.get(candidate.dominantKind) ?? 0;
    const third = Math.min(2, Math.floor((candidate.startMs / durationMs) * 3));
    const thirdCount = thirdCounts.get(third) ?? 0;
    if (kindCount >= 3) continue;
    if (thirdCount >= 5 && selected.length >= 8) continue;
    if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.78 && existing.dominantKind === candidate.dominantKind)) continue;
    selected.push(candidate);
    kindCounts.set(candidate.dominantKind, kindCount + 1);
    thirdCounts.set(third, thirdCount + 1);
    if (selected.length >= 12) break;
  }
  return selected;
}

function sectionGraph(
  sections: MusicMapSection[],
  lyrics: TrackLyricsContext,
  scenes: AudioScene[],
  hooks: MusicHookCandidate[],
  stems: TrackStem[],
): CreativeGraphSection[] {
  return sections.map((section) => {
    const window = { startMs: section.start_ms, endMs: section.end_ms };
    const lyricSections = lyrics.sections.filter((lyric) => lyric.startMs !== null && lyric.endMs !== null && overlapRatio(window, { startMs: lyric.startMs, endMs: lyric.endMs }) > 0.35);
    const lyricMoments = lyrics.moments.filter((moment) => moment.startMs !== null && moment.endMs !== null && overlapMs(window, { startMs: moment.startMs, endMs: moment.endMs }) > 0);
    const sceneIds = scenes.filter((scene) => scene.recommended_start_ms !== null && scene.recommended_end_ms !== null && overlapMs(window, { startMs: scene.recommended_start_ms, endMs: scene.recommended_end_ms }) > 0).map((scene) => scene.id);
    const hookIds = hooks.filter((hook) => overlapMs(window, { startMs: hook.start_ms, endMs: hook.end_ms }) > 0).map((hook) => hook.id);
    return {
      id: section.id,
      label: section.label,
      type: section.type,
      startMs: section.start_ms,
      endMs: section.end_ms,
      confidence: typeof section.confidence === "number" ? clamp01(section.confidence) : null,
      energy: clamp01(section.energy),
      lyricSectionKeys: lyricSections.map((item) => item.key),
      lyricMomentIds: lyricMoments.map((item) => item.id),
      audioSceneIds: sceneIds,
      hookIds,
      activeStemRoles: activeStemRoles(stems, section.start_ms, section.end_ms),
    };
  });
}

function coverage(values: Array<{ startMs: number | null; endMs: number | null }>) {
  if (!values.length) return 0;
  return values.filter((value) => value.startMs !== null && value.endMs !== null && value.endMs > value.startMs).length / values.length;
}

export function buildTrackCreativeIntelligenceGraph(input: {
  musicMap: MusicMap | null;
  lyrics: TrackLyricsContext;
  scenes: AudioScene[];
  stems: TrackStem[];
}): TrackCreativeIntelligenceGraph | null {
  const { musicMap, lyrics } = input;
  if (!musicMap) return null;
  const currentStems = input.stems.filter((stem) => stem.status === "ready");
  const currentScenes = input.scenes.filter((scene) => scene.status === "ready");
  const hooks = musicMap.hook_candidates ?? [];
  const seeds = [
    ...seedsFromMaster(musicMap),
    ...seedsFromLyrics(lyrics),
    ...seedsFromScenes(currentScenes),
  ];
  const stemConfidences = currentStems.map(stemTimelineConfidence).filter((value) => Number.isFinite(value));
  const analysisConfidence = musicMap.analysis?.confidence;
  return {
    version: 1,
    durationMs: musicMap.duration_ms,
    bpm: musicMap.bpm,
    highlights: clusterSeeds(seeds, currentStems),
    sections: sectionGraph(musicMap.sections, lyrics, currentScenes, hooks, currentStems),
    confidence: {
      masterOverall: typeof analysisConfidence?.overall === "number" ? clamp01(analysisConfidence.overall) : null,
      masterStructure: typeof analysisConfidence?.structure === "number" ? clamp01(analysisConfidence.structure) : null,
      lyricSectionTimingCoverage: coverage(lyrics.sections),
      lyricMomentTimingCoverage: coverage(lyrics.moments),
      stemTimelineConfidence: stemConfidences.length ? stemConfidences.reduce((sum, value) => sum + value, 0) / stemConfidences.length : null,
      audioScenePreviewCoverage: currentScenes.length ? currentScenes.filter((scene) => Boolean(scene.preview_asset_id)).length / currentScenes.length : 0,
    },
    provenance: {
      musicAnalysisVersion: musicMap.version ?? null,
      lyricsVersion: lyrics.version,
      stemAnalysisVersions: [...new Set(currentStems.map((stem) => stem.analysis_version).filter((value): value is number => typeof value === "number"))].sort((a, b) => a - b),
      audioSceneRecipeVersions: [...new Set(currentScenes.map((scene) => scene.recipe_version))].sort((a, b) => a - b),
    },
  };
}

export function conciseCreativeGraphContext(graph: TrackCreativeIntelligenceGraph | null) {
  if (!graph) return { status: "missing" };
  return {
    status: "ready",
    version: graph.version,
    durationMs: graph.durationMs,
    bpm: graph.bpm,
    confidence: graph.confidence,
    highlights: graph.highlights.slice(0, 8).map((highlight) => ({
      title: highlight.title,
      startMs: highlight.startMs,
      endMs: highlight.endMs,
      score: highlight.score,
      dominantKind: highlight.dominantKind,
      kinds: highlight.kinds,
      stemRoles: highlight.stemRoles,
      hookIds: highlight.hookIds,
      lyricMomentIds: highlight.lyricMomentIds,
      audioSceneIds: highlight.audioSceneIds,
      rationale: highlight.rationale.slice(0, 3),
      provenance: highlight.provenance,
    })),
    timeline: graph.sections.slice(0, 24).map((section) => ({
      id: section.id,
      label: section.label,
      type: section.type,
      startMs: section.startMs,
      endMs: section.endMs,
      energy: section.energy,
      lyricSections: section.lyricSectionKeys,
      lyricMoments: section.lyricMomentIds,
      scenes: section.audioSceneIds,
      hooks: section.hookIds.slice(0, 4),
      activeStemRoles: section.activeStemRoles,
    })),
    rule: "Treat this graph as the shared cross-modal timeline. Prefer highlights supported by multiple modalities and preserve timing/provenance; never infer lyric timing from section labels alone.",
  };
}
