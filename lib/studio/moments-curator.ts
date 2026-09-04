import type { Moment, MomentSourceMode } from "@/types/moments-database";

export const MOMENTS_V2_MAX_RESULTS = 5;
export const MOMENTS_V2_QUALITY_FLOOR = 0.52;
export const MOMENTS_V2_MIN_SECTION_MS = 8_000;
export const MOMENTS_V2_MAX_SECTION_MS = 45_000;

type JsonRecord = Record<string, unknown>;

export type LyricSectionEvidence = {
  id: string;
  track_id: string;
  section_key: string;
  section_type: string;
  label: string;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number | null;
  is_primary_hook: boolean;
};

export type LyricMomentEvidence = {
  id: string;
  track_id: string;
  section_key: string | null;
  excerpt: string;
  start_ms: number | null;
  end_ms: number | null;
  score: number | null;
};

export type CuratedMoment = Moment & {
  curation: {
    rank: number;
    quality_score: number;
    candidate_count: number;
    source_modes: MomentSourceMode[];
    section_key: string | null;
    section_type: string | null;
    section_label: string | null;
    primary_hook: boolean;
    promoted_to_full_section: boolean;
    manual_timing: boolean;
  };
};

export type MomentCurationResult = {
  curated: CuratedMoment[];
  historical: Moment[];
  raw_active_count: number;
  suppressed_count: number;
};

type Candidate = {
  moment: Moment;
  startMs: number;
  endMs: number;
  label: string;
  score: number;
  section: LyricSectionEvidence | null;
  promoted: boolean;
  manualTiming: boolean;
  clusterKey: string;
};

type Cluster = {
  representative: Candidate;
  members: Candidate[];
  sourceModes: MomentSourceMode[];
  qualityScore: number;
  lyricMomentId: string | null;
  purposeTags: string[];
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function validWindow(startMs: number | null | undefined, endMs: number | null | undefined) {
  return typeof startMs === "number" && Number.isFinite(startMs)
    && typeof endMs === "number" && Number.isFinite(endMs)
    && startMs >= 0 && endMs > startMs;
}

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function overlapRatioOfShorter(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  const overlap = overlapMs(aStart, aEnd, bStart, bEnd);
  return overlap / Math.max(1, Math.min(aEnd - aStart, bEnd - bStart));
}

function sourceModesForMoment(moment: Moment): MomentSourceMode[] {
  const modes = new Set<MomentSourceMode>();
  if (moment.source_mode !== "fused") modes.add(moment.source_mode);
  const evidence = record(moment.evidence);
  const sourceModes = Array.isArray(evidence.source_modes) ? evidence.source_modes : [];
  for (const sourceMode of sourceModes) {
    if (sourceMode === "audio" || sourceMode === "lyrics" || sourceMode === "stems") modes.add(sourceMode);
  }
  if (!modes.size) modes.add(moment.source_mode);
  return [...modes].sort();
}

function matchingSection(moment: Moment, sections: LyricSectionEvidence[]) {
  const evidence = record(moment.evidence);
  const evidenceSectionKey = typeof evidence.section_key === "string" ? evidence.section_key : null;
  const candidates = sections.filter((section) => section.track_id === moment.track_id && validWindow(section.start_ms, section.end_ms));
  let best: { section: LyricSectionEvidence; score: number } | null = null;

  for (const section of candidates) {
    const startMs = section.start_ms as number;
    const endMs = section.end_ms as number;
    const overlap = overlapMs(moment.start_ms, moment.end_ms, startMs, endMs);
    if (!overlap) continue;
    const candidateCoverage = overlap / Math.max(1, moment.end_ms - moment.start_ms);
    const sectionCoverage = overlap / Math.max(1, endMs - startMs);
    const keyBonus = evidenceSectionKey && evidenceSectionKey === section.section_key ? 0.35 : 0;
    const primaryBonus = section.is_primary_hook ? 0.08 : 0;
    const confidence = typeof section.confidence === "number" ? clamp01(section.confidence) : 0.65;
    const score = candidateCoverage * 0.54 + sectionCoverage * 0.24 + confidence * 0.14 + keyBonus + primaryBonus;
    if (!best || score > best.score) best = { section, score };
  }

  if (!best) return null;
  const section = best.section;
  const overlap = overlapMs(moment.start_ms, moment.end_ms, section.start_ms as number, section.end_ms as number);
  const candidateCoverage = overlap / Math.max(1, moment.end_ms - moment.start_ms);
  return candidateCoverage >= 0.55 || (evidenceSectionKey === section.section_key && overlap >= 2_000)
    ? section
    : null;
}

function durationQuality(durationMs: number) {
  if (durationMs >= 12_000 && durationMs <= 30_000) return 1;
  if (durationMs >= 8_000 && durationMs <= 40_000) return 0.86;
  if (durationMs >= 5_000 && durationMs <= 50_000) return 0.58;
  if (durationMs >= 3_000 && durationMs <= 60_000) return 0.34;
  return 0.12;
}

function sectionTypeBonus(section: LyricSectionEvidence | null) {
  if (!section) return 0;
  const type = section.section_type.toLowerCase();
  if (section.is_primary_hook) return 0.11;
  if (["chorus", "hook", "refrain", "post_chorus"].includes(type)) return 0.075;
  if (["verse", "pre_chorus", "bridge"].includes(type)) return 0.035;
  return 0.015;
}

function candidateScore(moment: Moment, startMs: number, endMs: number, section: LyricSectionEvidence | null, manualTiming: boolean) {
  const confidence = clamp01(moment.confidence ?? 0);
  const hook = clamp01(moment.hook_score ?? 0);
  const energy = clamp01(moment.energy_score ?? 0);
  const emotion = clamp01(moment.emotional_score ?? 0);
  const vocal = clamp01(moment.vocal_score ?? 0);
  const uniqueness = clamp01(moment.uniqueness_score ?? 0);
  const sectionConfidence = section && typeof section.confidence === "number" ? clamp01(section.confidence) : 0;
  const explicitChoiceBonus = moment.state === "approved" ? 0.15 : manualTiming ? 0.1 : 0;

  return clamp01(
    confidence * 0.34
    + hook * 0.20
    + energy * 0.10
    + emotion * 0.07
    + vocal * 0.07
    + uniqueness * 0.07
    + durationQuality(endMs - startMs) * 0.10
    + sectionConfidence * 0.05
    + sectionTypeBonus(section)
    + explicitChoiceBonus,
  );
}

function normalizeCandidate(moment: Moment, sections: LyricSectionEvidence[]): Candidate | null {
  if (!validWindow(moment.start_ms, moment.end_ms)) return null;
  const manualTiming = moment.start_ms !== moment.source_start_ms || moment.end_ms !== moment.source_end_ms;
  const section = matchingSection(moment, sections);
  let startMs = moment.start_ms;
  let endMs = moment.end_ms;
  let label = moment.label;
  let promoted = false;

  if (section && !manualTiming && moment.state !== "approved" && validWindow(section.start_ms, section.end_ms)) {
    const sectionStart = section.start_ms as number;
    const sectionEnd = section.end_ms as number;
    const sectionDuration = sectionEnd - sectionStart;
    const overlap = overlapMs(moment.start_ms, moment.end_ms, sectionStart, sectionEnd);
    const candidateCoverage = overlap / Math.max(1, moment.end_ms - moment.start_ms);
    const sectionCoverage = overlap / Math.max(1, sectionDuration);
    const isCompleteSectionCandidate = candidateCoverage >= 0.62 && (sectionCoverage >= 0.12 || section.is_primary_hook);
    if (sectionDuration >= MOMENTS_V2_MIN_SECTION_MS && sectionDuration <= MOMENTS_V2_MAX_SECTION_MS && isCompleteSectionCandidate) {
      startMs = sectionStart;
      endMs = sectionEnd;
      label = section.label || moment.label;
      promoted = startMs !== moment.start_ms || endMs !== moment.end_ms;
    }
  }

  const clusterKey = section
    ? `${moment.track_id}:section:${section.section_key}`
    : `${moment.track_id}:window:${Math.round(startMs / 2_500)}:${Math.round(endMs / 2_500)}`;

  return {
    moment,
    startMs,
    endMs,
    label,
    section,
    promoted,
    manualTiming,
    clusterKey,
    score: candidateScore(moment, startMs, endMs, section, manualTiming),
  };
}

function candidatesBelongTogether(a: Candidate, b: Candidate) {
  if (a.moment.track_id !== b.moment.track_id) return false;
  if (a.clusterKey === b.clusterKey) return true;
  if (a.section || b.section) return false;
  return overlapRatioOfShorter(a.startMs, a.endMs, b.startMs, b.endMs) >= 0.58
    || (Math.abs(a.startMs - b.startMs) <= 1_200 && Math.abs(a.endMs - b.endMs) <= 1_800);
}

function selectLyricMoment(members: Candidate[], lyricMoments: LyricMomentEvidence[], startMs: number, endMs: number) {
  const ids = new Set(members.map((member) => member.moment.lyric_moment_id).filter((value): value is string => Boolean(value)));
  const valid = lyricMoments
    .filter((lyric) => ids.has(lyric.id) && validWindow(lyric.start_ms, lyric.end_ms))
    .filter((lyric) => overlapRatioOfShorter(startMs, endMs, lyric.start_ms as number, lyric.end_ms as number) >= 0.68)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
  return valid[0]?.id ?? null;
}

function buildClusters(candidates: Candidate[], lyricMoments: LyricMomentEvidence[]) {
  const groups: Candidate[][] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.startMs - b.startMs || a.moment.id.localeCompare(b.moment.id))) {
    const group = groups.find((members) => members.some((member) => candidatesBelongTogether(member, candidate)));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }

  return groups.map((members): Cluster => {
    const representative = [...members].sort((a, b) => {
      const explicitA = a.moment.state === "approved" || a.manualTiming ? 1 : 0;
      const explicitB = b.moment.state === "approved" || b.manualTiming ? 1 : 0;
      return explicitB - explicitA || b.score - a.score || a.moment.id.localeCompare(b.moment.id);
    })[0];
    const sourceModes = [...new Set(members.flatMap((member) => sourceModesForMoment(member.moment)))].sort() as MomentSourceMode[];
    const fusionBoost = Math.min(0.09, Math.max(0, sourceModes.length - 1) * 0.045);
    const corroborationBoost = Math.min(0.04, Math.max(0, members.length - 1) * 0.008);
    const qualityScore = clamp01(representative.score + fusionBoost + corroborationBoost);
    const purposeTags = [...new Set(members.flatMap((member) => member.moment.purpose_tags ?? []))].slice(0, 8);
    const lyricMomentId = selectLyricMoment(members, lyricMoments, representative.startMs, representative.endMs);
    return { representative, members, sourceModes, qualityScore, lyricMomentId, purposeTags };
  });
}

function diversityAdjustedScore(cluster: Cluster, selected: Cluster[]) {
  const type = cluster.representative.section?.section_type ?? null;
  const sameType = type ? selected.filter((item) => item.representative.section?.section_type === type).length : 0;
  const repeatedTypePenalty = sameType === 0 ? 0 : sameType === 1 ? 0.055 : 0.14;
  return cluster.qualityScore - repeatedTypePenalty;
}

function selectClusters(clusters: Cluster[], maxResults: number, qualityFloor: number) {
  const explicit = clusters
    .filter((cluster) => cluster.members.some((member) => member.moment.state === "approved" || member.manualTiming))
    .sort((a, b) => b.qualityScore - a.qualityScore || a.representative.startMs - b.representative.startMs);
  const selected: Cluster[] = [...explicit];
  const remaining = clusters.filter((cluster) => !explicit.includes(cluster) && (
    cluster.qualityScore >= qualityFloor || cluster.representative.section?.is_primary_hook
  ));

  while (selected.length < maxResults && remaining.length) {
    remaining.sort((a, b) => {
      const scoreDiff = diversityAdjustedScore(b, selected) - diversityAdjustedScore(a, selected);
      return scoreDiff || a.representative.startMs - b.representative.startMs || a.representative.moment.id.localeCompare(b.representative.moment.id);
    });
    selected.push(remaining.shift() as Cluster);
  }

  return selected;
}

export function curateReleaseMoments({
  moments,
  sections = [],
  lyricMoments = [],
  maxResults = MOMENTS_V2_MAX_RESULTS,
  qualityFloor = MOMENTS_V2_QUALITY_FLOOR,
}: {
  moments: Moment[];
  sections?: LyricSectionEvidence[];
  lyricMoments?: LyricMomentEvidence[];
  maxResults?: number;
  qualityFloor?: number;
}): MomentCurationResult {
  const historical = moments
    .filter((moment) => moment.state === "rejected" || moment.state === "superseded")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const active = moments.filter((moment) => moment.state === "proposed" || moment.state === "approved");
  const candidates = active.map((moment) => normalizeCandidate(moment, sections)).filter((value): value is Candidate => Boolean(value));
  const clusters = buildClusters(candidates, lyricMoments);
  const selected = selectClusters(clusters, Math.max(1, maxResults), clamp01(qualityFloor));

  const curated = selected
    .sort((a, b) => b.qualityScore - a.qualityScore || a.representative.startMs - b.representative.startMs)
    .map((cluster, index): CuratedMoment => {
      const candidate = cluster.representative;
      const section = candidate.section;
      return {
        ...candidate.moment,
        start_ms: candidate.startMs,
        end_ms: candidate.endMs,
        label: candidate.label,
        lyric_moment_id: cluster.lyricMomentId,
        purpose_tags: cluster.purposeTags,
        curation: {
          rank: index + 1,
          quality_score: Math.round(cluster.qualityScore * 10_000) / 10_000,
          candidate_count: cluster.members.length,
          source_modes: cluster.sourceModes,
          section_key: section?.section_key ?? null,
          section_type: section?.section_type ?? null,
          section_label: section?.label ?? null,
          primary_hook: section?.is_primary_hook ?? false,
          promoted_to_full_section: candidate.promoted,
          manual_timing: candidate.manualTiming,
        },
      };
    });

  return {
    curated,
    historical,
    raw_active_count: active.length,
    suppressed_count: Math.max(0, active.length - curated.length),
  };
}
