import type {
  MusicHookCandidate,
  MusicHookIntentScores,
  MusicMap,
  MusicMomentIntent,
} from "@/lib/video-director/creative-director";

export const STRONGEST_MOMENT_MIN_MS = 12_000;
export const STRONGEST_MOMENT_TARGET_MS = 20_000;
export const STRONGEST_MOMENT_MAX_MS = 32_000;
export const STRONGEST_MOMENT_DIVERSITY_GAP_MS = 24_000;
export const STRONGEST_MOMENT_LIMIT = 5;
export const STRONGEST_MOMENT_MAX_PER_SECTION_TYPE = 2;

export type StrongestMomentPeakWindow = {
  candidate_id: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  score?: number;
  target_duration_ms?: number | null;
  label?: string | null;
};

export type StrongestMoment = {
  id: string;
  rank?: number;
  label: string;
  kind: MusicHookCandidate["kind"];
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  section_id?: string | null;
  section_type: string;
  section_label: string;
  score: number;
  intent_scores?: MusicHookIntentScores;
  reasons?: string[];
  peak_window: StrongestMomentPeakWindow;
  context?: {
    strategy?: string;
    target_duration_ms?: number;
    boundary_fit?: number;
    context_fit?: number;
    boundary_kinds?: { start?: string[]; end?: string[] };
  };
};

type StrongestMomentMap = MusicMap & {
  strongest_moments?: StrongestMoment[];
  hook_candidates_v3?: MusicHookCandidate[];
  musical_moments?: MusicHookCandidate[];
};

type BoundaryPoint = {
  ms: number;
  quality: number;
  kinds: Set<string>;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function overlapMs(a: Pick<StrongestMoment, "start_ms" | "end_ms">, b: Pick<StrongestMoment, "start_ms" | "end_ms">) {
  return Math.max(0, Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms));
}

function gapMs(a: Pick<StrongestMoment, "start_ms" | "end_ms">, b: Pick<StrongestMoment, "start_ms" | "end_ms">) {
  if (overlapMs(a, b) > 0) return 0;
  if (a.end_ms <= b.start_ms) return b.start_ms - a.end_ms;
  return a.start_ms - b.end_ms;
}

function dominantIntent(candidate: Pick<MusicHookCandidate, "kind" | "intent_scores">) {
  const entries = Object.entries(candidate.intent_scores ?? {})
    .filter((entry): entry is [MusicMomentIntent, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? candidate.kind ?? "musical_identity";
}

function sectionFor(ms: number, map: MusicMap) {
  return map.sections.find((section) => section.start_ms <= ms && ms < section.end_ms) ?? null;
}

function addBoundary(points: Map<number, BoundaryPoint>, ms: number, durationMs: number, quality: number, kind: string) {
  const normalizedMs = clamp(Math.round(ms), 0, durationMs);
  const current = points.get(normalizedMs) ?? {
    ms: normalizedMs,
    quality: 0,
    kinds: new Set<string>(),
  };
  current.quality = Math.max(current.quality, clamp01(quality));
  current.kinds.add(kind);
  points.set(normalizedMs, current);
}

function boundaryPoints(map: MusicMap) {
  const durationMs = Math.max(1, map.duration_ms);
  const points = new Map<number, BoundaryPoint>();
  addBoundary(points, 0, durationMs, 0.96, "track");
  addBoundary(points, durationMs, durationMs, 0.96, "track");

  for (const section of map.sections) {
    const confidence = clamp01(section.boundary_confidence ?? section.confidence ?? 0.55);
    const quality = 0.86 + 0.12 * confidence;
    addBoundary(points, section.start_ms, durationMs, quality, "section");
    addBoundary(points, section.end_ms, durationMs, quality, "section");
  }

  for (const phrase of map.phrases ?? []) {
    const quality = 0.78 + 0.16 * clamp01(phrase.confidence ?? 0.5);
    addBoundary(points, phrase.start_ms, durationMs, quality, "phrase");
    addBoundary(points, phrase.end_ms, durationMs, quality, "phrase");
  }

  const modelDownbeats = (map.downbeat_source ?? map.analysis?.downbeat_source) === "model";
  for (const bar of map.bars ?? []) {
    const quality = modelDownbeats ? 0.82 : 0.62;
    addBoundary(points, bar.start_ms, durationMs, quality, "bar");
    addBoundary(points, bar.end_ms, durationMs, quality, "bar");
  }

  for (const downbeat of map.downbeats_ms ?? []) {
    addBoundary(points, downbeat, durationMs, modelDownbeats ? 0.76 : 0.56, "downbeat");
  }

  return [...points.values()].sort((a, b) => a.ms - b.ms);
}

function exactSectionBonus(left: number, right: number, peakMidpoint: number, map: MusicMap) {
  return map.sections.some(
    (section) => section.start_ms === left && section.end_ms === right && section.start_ms <= peakMidpoint && peakMidpoint < section.end_ms,
  ) ? 1 : 0;
}

function sectionCrossings(left: number, right: number, map: MusicMap) {
  const boundaries = new Set(map.sections.map((section) => section.start_ms));
  return [...boundaries].filter((point) => left < point && point < right).length;
}

function contextualWindow(peak: StrongestMomentPeakWindow, map: MusicMap) {
  const durationMs = Math.max(1, map.duration_ms);
  const peakStart = clamp(peak.start_ms, 0, durationMs);
  const peakEnd = clamp(Math.max(peakStart + 1, peak.end_ms), peakStart + 1, durationMs);
  const effectiveMin = Math.min(STRONGEST_MOMENT_MIN_MS, durationMs);
  const effectiveMax = Math.min(STRONGEST_MOMENT_MAX_MS, durationMs);
  const target = Math.min(STRONGEST_MOMENT_TARGET_MS, durationMs);
  const peakMidpoint = peakStart + (peakEnd - peakStart) / 2;
  const points = boundaryPoints(map);
  const leftPoints = points.filter((point) => point.ms <= peakStart);
  const rightPoints = points.filter((point) => point.ms >= peakEnd);

  let best: { value: number; left: BoundaryPoint; right: BoundaryPoint } | null = null;
  for (const left of leftPoints) {
    if (peakStart - left.ms > effectiveMax) continue;
    for (const right of rightPoints) {
      const visibleDuration = right.ms - left.ms;
      if (visibleDuration < effectiveMin || visibleDuration > effectiveMax) continue;

      const durationFit = clamp01(1 - Math.abs(visibleDuration - target) / Math.max(target, 1));
      const boundaryFit = (left.quality + right.quality) / 2;
      const visibleMidpoint = left.ms + visibleDuration / 2;
      const centerFit = clamp01(1 - Math.abs(visibleMidpoint - peakMidpoint) / Math.max(visibleDuration / 2, 1));
      const exactSection = exactSectionBonus(left.ms, right.ms, peakMidpoint, map);
      const phraseEdges = left.kinds.has("phrase") && right.kinds.has("phrase") ? 1 : 0;
      const crossings = sectionCrossings(left.ms, right.ms, map);
      const coherence = crossings === 0 ? 1 : Math.max(0, 1 - 0.35 * crossings);
      const value = 0.38 * durationFit
        + 0.25 * boundaryFit
        + 0.15 * centerFit
        + 0.14 * exactSection
        + 0.05 * phraseEdges
        + 0.03 * coherence;

      if (!best || value > best.value) best = { value, left, right };
    }
  }

  if (best) {
    return {
      start_ms: best.left.ms,
      end_ms: best.right.ms,
      duration_ms: best.right.ms - best.left.ms,
      boundary_fit: clamp01((best.left.quality + best.right.quality) / 2),
      context_fit: clamp01(best.value),
      boundary_kinds: {
        start: [...best.left.kinds].sort(),
        end: [...best.right.kinds].sort(),
      },
    };
  }

  const desired = Math.min(effectiveMax, Math.max(effectiveMin, target));
  let start = clamp(Math.round(peakMidpoint - desired / 2), 0, Math.max(0, durationMs - desired));
  let end = Math.min(durationMs, start + desired);
  if (start > peakStart) start = peakStart;
  if (end < peakEnd) {
    end = peakEnd;
    start = Math.max(0, end - desired);
  }
  return {
    start_ms: start,
    end_ms: end,
    duration_ms: end - start,
    boundary_fit: 0.25,
    context_fit: 0.35,
    boundary_kinds: { start: ["free_time"], end: ["free_time"] },
  };
}

function peakFromCandidate(candidate: MusicHookCandidate): StrongestMomentPeakWindow {
  return {
    candidate_id: candidate.id,
    start_ms: candidate.start_ms,
    end_ms: candidate.end_ms,
    duration_ms: Math.max(0, candidate.end_ms - candidate.start_ms),
    score: candidate.score,
    target_duration_ms: candidate.target_duration_ms,
    label: candidate.label,
  };
}

function contextualizeCandidate(candidate: MusicHookCandidate, map: MusicMap): StrongestMoment {
  const peak = peakFromCandidate(candidate);
  const context = contextualWindow(peak, map);
  const midpoint = peak.start_ms + Math.max(0, peak.end_ms - peak.start_ms) / 2;
  const section = sectionFor(midpoint, map);
  const intent = dominantIntent(candidate);
  return {
    id: `strongest-${candidate.id}`,
    label: candidate.label,
    kind: intent,
    start_ms: context.start_ms,
    end_ms: context.end_ms,
    duration_ms: context.duration_ms,
    section_id: section?.id ?? null,
    section_type: candidate.section_type || section?.type || "section",
    section_label: candidate.section_label || section?.label || "Musical phrase",
    score: candidate.score,
    intent_scores: candidate.intent_scores,
    reasons: ["Playback expands the scoring peak to complete musical context.", ...(candidate.reasons ?? [])].slice(0, 4),
    peak_window: peak,
    context: {
      strategy: "analysis_peak_with_musical_context",
      target_duration_ms: STRONGEST_MOMENT_TARGET_MS,
      boundary_fit: context.boundary_fit,
      context_fit: context.context_fit,
      boundary_kinds: context.boundary_kinds,
    },
  };
}

function normalizeCanonicalMoment(moment: StrongestMoment): StrongestMoment | null {
  if (!Number.isFinite(moment.start_ms) || !Number.isFinite(moment.end_ms) || moment.end_ms <= moment.start_ms) return null;
  const peak = moment.peak_window && moment.peak_window.end_ms > moment.peak_window.start_ms
    ? moment.peak_window
    : {
        candidate_id: moment.id,
        start_ms: moment.start_ms,
        end_ms: moment.end_ms,
        duration_ms: moment.end_ms - moment.start_ms,
        score: moment.score,
        label: moment.label,
      };
  return {
    ...moment,
    duration_ms: moment.end_ms - moment.start_ms,
    peak_window: peak,
  };
}

function dedupeWindows(candidates: StrongestMoment[]) {
  const best = new Map<string, StrongestMoment>();
  for (const candidate of candidates) {
    const key = `${candidate.start_ms}:${candidate.end_ms}`;
    const current = best.get(key);
    if (!current || candidate.score > current.score) best.set(key, candidate);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.start_ms - b.start_ms);
}

function selectDiverse(candidates: StrongestMoment[]) {
  const selected: StrongestMoment[] = [];
  const selectedIds = new Set<string>();
  const seenIntents = new Set<string>();
  const seenSections = new Set<string>();
  const sectionTypeCounts = new Map<string, number>();

  while (selected.length < Math.min(STRONGEST_MOMENT_LIMIT, candidates.length)) {
    let best: StrongestMoment | null = null;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.id)) continue;
      if (selected.some((existing) => overlapMs(candidate, existing) > 0)) continue;

      const sectionType = candidate.section_type || "section";
      const sectionTypeCount = sectionTypeCounts.get(sectionType) ?? 0;
      if (sectionTypeCount >= STRONGEST_MOMENT_MAX_PER_SECTION_TYPE) continue;

      const intent = String(candidate.kind || "musical_identity");
      const section = String(candidate.section_id || candidate.section_label || "");
      let value = candidate.score;
      if (!seenIntents.has(intent)) value += 0.06;
      if (section && !seenSections.has(section)) value += 0.04;
      if (sectionTypeCount === 0) value += 0.02;

      if (selected.length) {
        const nearestGap = Math.min(...selected.map((existing) => gapMs(candidate, existing)));
        if (nearestGap < STRONGEST_MOMENT_DIVERSITY_GAP_MS) {
          value -= 0.08 * (1 - nearestGap / STRONGEST_MOMENT_DIVERSITY_GAP_MS);
        }
      }
      value += 0.025 * (candidate.context?.context_fit ?? 0);
      if (value > bestValue) {
        best = candidate;
        bestValue = value;
      }
    }

    if (!best) break;
    selected.push(best);
    selectedIds.add(best.id);
    const intent = String(best.kind || "musical_identity");
    const section = String(best.section_id || best.section_label || "");
    const sectionType = best.section_type || "section";
    seenIntents.add(intent);
    if (section) seenSections.add(section);
    sectionTypeCounts.set(sectionType, (sectionTypeCounts.get(sectionType) ?? 0) + 1);
  }

  return selected.map((moment, index) => ({ ...moment, rank: index + 1 }));
}

export function selectStrongestMoments(map: MusicMap | null): StrongestMoment[] {
  if (!map) return [];
  const enriched = map as StrongestMomentMap;
  const canonical = (enriched.strongest_moments ?? [])
    .map(normalizeCanonicalMoment)
    .filter((moment): moment is StrongestMoment => moment !== null);
  if (canonical.length) return selectDiverse(dedupeWindows(canonical));

  const scoringWindows = enriched.hook_candidates_v3?.length
    ? enriched.hook_candidates_v3
    : map.hook_candidates?.length
      ? map.hook_candidates
      : enriched.musical_moments ?? [];
  const contextualized = scoringWindows
    .filter((candidate) => Number.isFinite(candidate.start_ms) && Number.isFinite(candidate.end_ms) && candidate.end_ms > candidate.start_ms)
    .sort((a, b) => b.score - a.score || a.start_ms - b.start_ms)
    .map((candidate) => contextualizeCandidate(candidate, map));
  return selectDiverse(dedupeWindows(contextualized));
}

export function strongestMomentIntentLabel(moment: StrongestMoment) {
  return String(dominantIntent(moment as MusicHookCandidate)).replaceAll("_", " ");
}

export function strongestMomentTitle(moment: StrongestMoment) {
  const section = moment.section_label || "Moment";
  const intent = dominantIntent(moment as MusicHookCandidate);
  if (intent === "musical_identity") return `Signature ${section}`;
  if (intent === "instant_hook") return `Instant Hook · ${section}`;
  if (intent === "groove_loop") return `Groove Pocket · ${section}`;
  if (intent === "build_drop") return `Build & Release · ${section}`;
  if (intent === "climax") return `Peak Moment · ${section}`;
  if (intent === "story_arc") return `Story Arc · ${section}`;
  return moment.label;
}

export function strongestMomentDurationLabel(moment: StrongestMoment) {
  return `${Math.max(1, Math.round(moment.duration_ms / 1000))} sec`;
}
