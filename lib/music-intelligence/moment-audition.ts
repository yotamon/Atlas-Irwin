import type { MusicMap } from "@/lib/video-director/creative-director";
import {
  STRONGEST_MOMENT_MAX_MS,
  STRONGEST_MOMENT_MIN_MS,
  STRONGEST_MOMENT_TARGET_MS,
  selectStrongestMoments,
  type StrongestMoment,
} from "@/lib/music-intelligence/strongest-moments";

export type MomentRhythmSync = {
  beat_locked: boolean;
  grid_source: "canonical_beats" | "downbeats" | "bar_grid" | "none";
  beat_period_ms?: number | null;
  start_anchor?: "downbeat" | "bar" | "beat" | "track" | "rhythm";
  end_anchor?: "downbeat" | "bar" | "beat" | "track" | "rhythm";
  start_shift_ms?: number;
  end_shift_ms?: number;
  sync_fit?: number;
  reason?: string;
};

export type AuditionMoment = StrongestMoment & {
  context?: StrongestMoment["context"] & {
    rhythm_sync?: MomentRhythmSync;
  };
};

type RhythmAnchor = {
  ms: number;
  quality: number;
  kinds: Set<string>;
};

type RhythmGrid = {
  available: boolean;
  source: MomentRhythmSync["grid_source"];
  beatPeriodMs: number | null;
  anchors: RhythmAnchor[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function overlapMs(
  a: Pick<AuditionMoment, "start_ms" | "end_ms">,
  b: Pick<AuditionMoment, "start_ms" | "end_ms">,
) {
  return Math.max(0, Math.min(a.end_ms, b.end_ms) - Math.max(a.start_ms, b.start_ms));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function uniqueTimes(values: Array<number | null | undefined>, durationMs: number) {
  return [...new Set(
    values
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map((value) => clamp(Math.round(value), 0, durationMs)),
  )].sort((a, b) => a - b);
}

function nearest(value: number, points: number[]) {
  if (!points.length) return null;
  let best = points[0];
  let bestDistance = Math.abs(best - value);
  for (const point of points.slice(1)) {
    const distance = Math.abs(point - value);
    if (distance < bestDistance || (distance === bestDistance && point < best)) {
      best = point;
      bestDistance = distance;
    }
  }
  return { point: best, distance: bestDistance };
}

function addAnchor(
  anchors: Map<number, RhythmAnchor>,
  ms: number,
  quality: number,
  kind: string,
) {
  const current = anchors.get(ms) ?? { ms, quality: 0, kinds: new Set<string>() };
  current.quality = Math.max(current.quality, clamp01(quality));
  current.kinds.add(kind);
  anchors.set(ms, current);
}

function rhythmGrid(map: MusicMap): RhythmGrid {
  const durationMs = Math.max(1, map.duration_ms);
  const beats = uniqueTimes(map.beats_ms ?? [], durationMs);
  const downbeats = uniqueTimes(map.downbeats_ms ?? [], durationMs);
  const barPoints = uniqueTimes(
    (map.bars ?? []).flatMap((bar) => [bar.start_ms, bar.end_ms]),
    durationMs,
  );
  const beatDifferences = beats
    .slice(1)
    .map((beat, index) => beat - beats[index])
    .filter((difference) => difference >= 140 && difference <= 2_200);
  const bpmPeriod = map.bpm && map.bpm >= 25 && map.bpm <= 300
    ? 60_000 / map.bpm
    : null;
  const beatPeriodMs = median(beatDifferences) ?? bpmPeriod;
  const anchors = new Map<number, RhythmAnchor>();
  const downbeatSource = map.downbeat_source ?? map.analysis?.downbeat_source ?? "none";
  let source: RhythmGrid["source"] = "none";

  if (beats.length) {
    source = "canonical_beats";
    const beatQuality = 0.72 + 0.2 * clamp01(map.beat_confidence ?? 0);
    for (const beat of beats) addAnchor(anchors, beat, beatQuality, "beat");

    const tolerance = Math.max(70, Math.min(180, (beatPeriodMs ?? 500) * 0.32));
    for (const downbeat of downbeats) {
      const match = nearest(downbeat, beats);
      if (match && match.distance <= tolerance) {
        addAnchor(anchors, match.point, downbeatSource === "model" ? 0.99 : 0.86, "downbeat");
      }
    }
    for (const barPoint of barPoints) {
      const match = nearest(barPoint, beats);
      if (match && match.distance <= tolerance) {
        addAnchor(anchors, match.point, downbeatSource === "model" ? 0.96 : 0.84, "bar");
      }
    }
  } else if (downbeats.length) {
    source = "downbeats";
    for (const downbeat of downbeats) {
      addAnchor(anchors, downbeat, downbeatSource === "model" ? 0.98 : 0.82, "downbeat");
    }
  } else if (barPoints.length) {
    source = "bar_grid";
    for (const barPoint of barPoints) {
      addAnchor(anchors, barPoint, downbeatSource === "model" ? 0.88 : 0.72, "bar");
    }
  }

  if (anchors.size) {
    addAnchor(anchors, 0, 0.98, "track");
    addAnchor(anchors, durationMs, 0.98, "track");
  }

  return {
    available: anchors.size > 0,
    source,
    beatPeriodMs,
    anchors: [...anchors.values()].sort((a, b) => a.ms - b.ms),
  };
}

function semanticBoundaries(map: MusicMap) {
  return uniqueTimes([
    0,
    map.duration_ms,
    ...map.sections.flatMap((section) => [section.start_ms, section.end_ms]),
    ...(map.phrases ?? []).flatMap((phrase) => [phrase.start_ms, phrase.end_ms]),
  ], Math.max(1, map.duration_ms));
}

function semanticFit(ms: number, boundaries: number[], beatPeriodMs: number | null) {
  if (!boundaries.length) return 0;
  const distance = Math.min(...boundaries.map((boundary) => Math.abs(boundary - ms)));
  const tolerance = Math.max(120, Math.min(900, (beatPeriodMs ?? 500) * 1.25));
  return clamp01(1 - distance / tolerance);
}

function anchorLabel(anchor: RhythmAnchor): NonNullable<MomentRhythmSync["start_anchor"]> {
  for (const preferred of ["downbeat", "bar", "beat", "track"] as const) {
    if (anchor.kinds.has(preferred)) return preferred;
  }
  return "rhythm";
}

function syncMoment(
  moment: StrongestMoment,
  map: MusicMap,
  grid: RhythmGrid,
  boundaries: number[],
  avoid: AuditionMoment[],
): AuditionMoment | null {
  const durationMs = Math.max(1, map.duration_ms);
  const peak = moment.peak_window ?? {
    candidate_id: moment.id,
    start_ms: moment.start_ms,
    end_ms: moment.end_ms,
    duration_ms: moment.end_ms - moment.start_ms,
  };
  const peakStart = clamp(peak.start_ms, 0, durationMs);
  const peakEnd = clamp(Math.max(peakStart + 1, peak.end_ms), peakStart + 1, durationMs);
  const currentStart = clamp(Math.min(moment.start_ms, peakStart), 0, peakStart);
  const currentEnd = clamp(Math.max(moment.end_ms, peakEnd), peakEnd, durationMs);
  const originalDuration = Math.max(1, currentEnd - currentStart);
  const effectiveMin = Math.min(STRONGEST_MOMENT_MIN_MS, durationMs);
  const effectiveMax = Math.min(STRONGEST_MOMENT_MAX_MS, durationMs);
  const targetDuration = clamp(
    originalDuration || Math.min(STRONGEST_MOMENT_TARGET_MS, durationMs),
    effectiveMin,
    effectiveMax,
  );
  const edgeTolerance = Math.max(250, Math.min(2_000, (grid.beatPeriodMs ?? 500) * 2.2));
  const leftAnchors = grid.anchors.filter((anchor) => anchor.ms <= peakStart);
  const rightAnchors = grid.anchors.filter((anchor) => anchor.ms >= peakEnd);

  let best: { value: number; left: RhythmAnchor; right: RhythmAnchor } | null = null;
  for (const left of leftAnchors) {
    if (peakStart - left.ms > effectiveMax) continue;
    for (const right of rightAnchors) {
      const visibleDuration = right.ms - left.ms;
      if (visibleDuration < effectiveMin || visibleDuration > effectiveMax) continue;
      const candidate = { start_ms: left.ms, end_ms: right.ms };
      if (avoid.some((existing) => overlapMs(candidate, existing) > 0)) continue;

      const durationFit = clamp01(1 - Math.abs(visibleDuration - targetDuration) / Math.max(targetDuration, 1));
      const edgeFit = (
        clamp01(1 - Math.abs(left.ms - currentStart) / edgeTolerance)
        + clamp01(1 - Math.abs(right.ms - currentEnd) / edgeTolerance)
      ) / 2;
      const anchorQuality = (left.quality + right.quality) / 2;
      const boundaryFit = (
        semanticFit(left.ms, boundaries, grid.beatPeriodMs)
        + semanticFit(right.ms, boundaries, grid.beatPeriodMs)
      ) / 2;
      const visibleMidpoint = left.ms + visibleDuration / 2;
      const peakMidpoint = peakStart + (peakEnd - peakStart) / 2;
      const centerFit = clamp01(1 - Math.abs(visibleMidpoint - peakMidpoint) / Math.max(visibleDuration / 2, 1));
      const startDownbeat = Number([...left.kinds].some((kind) => ["downbeat", "bar", "track"].includes(kind)));
      const endDownbeat = Number([...right.kinds].some((kind) => ["downbeat", "bar", "track"].includes(kind)));
      const value = 0.24 * durationFit
        + 0.24 * edgeFit
        + 0.22 * anchorQuality
        + 0.14 * boundaryFit
        + 0.08 * centerFit
        + 0.055 * startDownbeat
        + 0.025 * endDownbeat;

      if (!best || value > best.value) best = { value, left, right };
    }
  }

  if (!best) return null;
  const rhythmSync: MomentRhythmSync = {
    beat_locked: true,
    grid_source: grid.source,
    beat_period_ms: grid.beatPeriodMs ? Math.round(grid.beatPeriodMs * 100) / 100 : null,
    start_anchor: anchorLabel(best.left),
    end_anchor: anchorLabel(best.right),
    start_shift_ms: best.left.ms - currentStart,
    end_shift_ms: best.right.ms - currentEnd,
    sync_fit: Math.round(clamp01(best.value) * 10_000) / 10_000,
  };

  return {
    ...moment,
    start_ms: best.left.ms,
    end_ms: best.right.ms,
    duration_ms: best.right.ms - best.left.ms,
    context: {
      ...(moment.context ?? {}),
      rhythm_sync: rhythmSync,
    },
  };
}

export function selectAuditionMoments(map: MusicMap | null): AuditionMoment[] {
  if (!map) return [];
  const moments = selectStrongestMoments(map);
  const grid = rhythmGrid(map);
  if (!grid.available) {
    return moments.map((moment) => ({
      ...moment,
      context: {
        ...(moment.context ?? {}),
        rhythm_sync: {
          beat_locked: false,
          grid_source: "none",
          reason: "No trustworthy beat, downbeat, or bar anchors were available.",
        },
      },
    }));
  }

  const boundaries = semanticBoundaries(map);
  const selected: AuditionMoment[] = [];
  for (const moment of moments) {
    const synchronized = syncMoment(moment, map, grid, boundaries, selected);
    if (synchronized) selected.push(synchronized);
  }
  return selected.map((moment, index) => ({ ...moment, rank: index + 1 }));
}

export function momentRhythmSyncLabel(moment: AuditionMoment) {
  const sync = moment.context?.rhythm_sync;
  if (!sync?.beat_locked) return "musical boundary";
  if (sync.start_anchor === "downbeat" || sync.start_anchor === "bar") return "downbeat synced";
  return "beat synced";
}

export function momentFadeDurations(bpm: number | null | undefined, durationMs: number) {
  const beatMs = bpm && bpm >= 25 && bpm <= 300 ? 60_000 / bpm : 500;
  const fadeInMs = clamp(Math.round(beatMs * 0.09), 30, 55);
  const fadeOutMs = clamp(Math.round(beatMs * 0.22), 90, 150);
  const safeDuration = Math.max(1, durationMs);
  const scale = Math.min(1, safeDuration / Math.max(1, (fadeInMs + fadeOutMs) * 4));
  return {
    fadeInMs: Math.max(12, Math.round(fadeInMs * scale)),
    fadeOutMs: Math.max(28, Math.round(fadeOutMs * scale)),
  };
}

export function momentAuditionGain(
  elapsedMs: number,
  durationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
) {
  if (durationMs <= 0) return 0;
  const fadeInProgress = fadeInMs <= 0 ? 1 : clamp01(elapsedMs / fadeInMs);
  const remainingMs = durationMs - elapsedMs;
  const fadeOutProgress = fadeOutMs <= 0 ? 1 : clamp01(remainingMs / fadeOutMs);
  const fadeInGain = Math.sin(fadeInProgress * Math.PI / 2);
  const fadeOutGain = Math.sin(fadeOutProgress * Math.PI / 2);
  return clamp01(Math.min(fadeInGain, fadeOutGain));
}
