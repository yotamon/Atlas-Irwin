import type { MusicMapSection } from "@/lib/video-director/creative-director";
import type { TrackLyricSection } from "@/types/lyrics-database";

export type VocalSectionActivity = {
  activeRatio: number;
  energy: number;
  rhythmicActivity: number;
};

export type VocalActivitySlice = {
  startMs: number;
  endMs: number;
  energy: number;
  activeRatio: number;
  rhythmicActivity: number;
};

export type LyricLineTimingInput = {
  id: string;
  display_order: number;
  text: string;
};

export type LyricLineTiming = {
  id: string;
  startMs: number;
  endMs: number;
};

export type SectionAlignment = {
  lyricSectionId: string;
  musicSection: MusicMapSection | null;
  score: number;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalizedSectionType(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");
}

function typeAffinity(lyricType: string, music: MusicMapSection) {
  const expected = normalizedSectionType(lyricType);
  const actual = normalizedSectionType(music.type);
  const label = normalizedSectionType(music.label);
  if (actual === expected || label.includes(expected)) return 1;

  const hookFamily = new Set(["chorus", "refrain", "hook", "post_chorus"]);
  if (hookFamily.has(expected) && (hookFamily.has(actual) || [...hookFamily].some((value) => label.includes(value)))) return 0.72;
  if (expected === "pre_chorus" && actual === "verse") return 0.35;
  if (expected === "bridge" && ["break", "inst", "solo", "section"].includes(actual)) return 0.28;
  if (expected === "other" || actual === "section") return 0.18;
  return 0;
}

function wordCount(text: string) {
  return Math.max(1, text.trim().split(/\s+/).filter(Boolean).length);
}

function lineWeight(line: LyricLineTimingInput) {
  return Math.max(1.5, Math.sqrt(wordCount(line.text)) + line.text.length / 42);
}

function durationFitness(section: TrackLyricSection, music: MusicMapSection) {
  const duration = Math.max(1, music.end_ms - music.start_ms);
  const words = wordCount(section.text);
  // Sung text is highly variable, but values below roughly 230ms/word are usually impossible.
  const hardMinimum = Math.max(900, words * 230);
  if (duration >= hardMinimum) return 1;
  return clamp01(duration / hardMinimum);
}

function matchScore(
  lyric: TrackLyricSection,
  music: MusicMapSection,
  lyricIndex: number,
  musicIndex: number,
  lyricCount: number,
  musicCount: number,
  vocalActivity: Map<string, VocalSectionActivity>,
) {
  const affinity = typeAffinity(lyric.section_type, music);
  if (affinity <= 0) return Number.NEGATIVE_INFINITY;

  const lyricPosition = lyricCount <= 1 ? 0.5 : lyricIndex / (lyricCount - 1);
  const musicPosition = musicCount <= 1 ? 0.5 : musicIndex / (musicCount - 1);
  const positionFit = 1 - Math.min(1, Math.abs(lyricPosition - musicPosition));
  const activity = vocalActivity.get(music.id);
  const vocalEvidence = activity
    ? clamp01(activity.activeRatio * 0.62 + activity.energy * 0.28 + activity.rhythmicActivity * 0.1)
    : 0.35;
  const confidence = clamp01(Number(music.confidence ?? 0.45));
  const durationFit = durationFitness(lyric, music);

  return affinity * 5.0
    + vocalEvidence * 1.7
    + durationFit * 1.25
    + positionFit * 0.9
    + confidence * 0.45;
}

/**
 * Globally aligns lyric sections to music sections while preserving chronology.
 * Unlike a greedy same-type lookup, this can never place a later lyric section
 * before an earlier one. A weak section is left unresolved rather than assigned
 * a confidently wrong time range.
 */
export function alignLyricSectionsMonotonically(
  lyricSections: TrackLyricSection[],
  musicSections: MusicMapSection[],
  vocalActivity: Map<string, VocalSectionActivity> = new Map(),
): SectionAlignment[] {
  const lyrics = [...lyricSections].sort((a, b) => a.display_order - b.display_order);
  const music = [...musicSections].sort((a, b) => a.start_ms - b.start_ms);
  const memo = new Map<string, { score: number; matches: Array<number | null> }>();

  function solve(lyricIndex: number, minimumMusicIndex: number): { score: number; matches: Array<number | null> } {
    if (lyricIndex >= lyrics.length) return { score: 0, matches: [] };
    const key = `${lyricIndex}:${minimumMusicIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;

    // Unresolved is intentionally preferable to a low-evidence fabricated match.
    const skipped = solve(lyricIndex + 1, minimumMusicIndex);
    let best = { score: skipped.score - 1.15, matches: [null, ...skipped.matches] as Array<number | null> };

    for (let musicIndex = minimumMusicIndex; musicIndex < music.length; musicIndex += 1) {
      const score = matchScore(
        lyrics[lyricIndex],
        music[musicIndex],
        lyricIndex,
        musicIndex,
        lyrics.length,
        music.length,
        vocalActivity,
      );
      if (!Number.isFinite(score)) continue;
      const rest = solve(lyricIndex + 1, musicIndex + 1);
      const candidate = { score: score + rest.score, matches: [musicIndex, ...rest.matches] as Array<number | null> };
      if (candidate.score > best.score) best = candidate;
    }

    memo.set(key, best);
    return best;
  }

  const solved = solve(0, 0);
  return lyrics.map((section, index) => {
    const musicIndex = solved.matches[index];
    const matched = musicIndex === null || musicIndex === undefined ? null : music[musicIndex] ?? null;
    const score = matched
      ? matchScore(section, matched, index, musicIndex!, lyrics.length, music.length, vocalActivity)
      : 0;
    return { lyricSectionId: section.id, musicSection: matched, score };
  });
}

/**
 * Produces deterministic line-level windows inside an already aligned lyric
 * section. Durations are weighted by text length, so short interjections do not
 * consume the same time as full sentences. This is deliberately marked by the
 * caller as derived `alignment`, never manual truth.
 */
export function interpolateLyricLineTimings(
  sectionStartMs: number,
  sectionEndMs: number,
  lines: LyricLineTimingInput[],
): LyricLineTiming[] {
  const ordered = [...lines].sort((a, b) => a.display_order - b.display_order);
  if (!ordered.length || sectionEndMs <= sectionStartMs) return [];
  const span = sectionEndMs - sectionStartMs;
  const weights = ordered.map(lineWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = sectionStartMs;

  return ordered.map((line, index) => {
    const remaining = sectionEndMs - cursor;
    const raw = index === ordered.length - 1
      ? remaining
      : Math.round(span * (weights[index] / totalWeight));
    const duration = Math.max(120, Math.min(remaining, raw));
    const endMs = index === ordered.length - 1 ? sectionEndMs : Math.min(sectionEndMs, cursor + duration);
    const result = { id: line.id, startMs: cursor, endMs: Math.max(cursor + 1, endMs) };
    cursor = result.endMs;
    return result;
  });
}

function vocalMass(slice: VocalActivitySlice) {
  return Math.max(0.015, clamp01(slice.activeRatio) * 0.58 + clamp01(slice.energy) * 0.30 + clamp01(slice.rhythmicActivity) * 0.12);
}

/**
 * Refines line boundaries with the isolated-vocal activity curve. It does not claim
 * phoneme/word recognition; it allocates textual line mass over where singing is
 * acoustically present and falls back to text-weighted interpolation when evidence
 * is too sparse. This is materially safer than evenly spreading lines across silence.
 */
export function alignLyricLinesToVocalActivity(
  sectionStartMs: number,
  sectionEndMs: number,
  lines: LyricLineTimingInput[],
  activity: VocalActivitySlice[],
): LyricLineTiming[] {
  const ordered = [...lines].sort((a, b) => a.display_order - b.display_order);
  if (!ordered.length || sectionEndMs <= sectionStartMs) return [];
  const slices = activity
    .filter((slice) => slice.endMs > sectionStartMs && slice.startMs < sectionEndMs)
    .map((slice) => ({
      ...slice,
      startMs: Math.max(sectionStartMs, slice.startMs),
      endMs: Math.min(sectionEndMs, slice.endMs),
    }))
    .filter((slice) => slice.endMs > slice.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (slices.length < 2) return interpolateLyricLineTimings(sectionStartMs, sectionEndMs, ordered);

  const weightedSlices = slices.map((slice) => ({
    ...slice,
    mass: vocalMass(slice) * Math.max(1, slice.endMs - slice.startMs),
  }));
  const totalActivityMass = weightedSlices.reduce((sum, slice) => sum + slice.mass, 0);
  const activeEvidence = weightedSlices.reduce((sum, slice) => sum + (slice.activeRatio >= 0.12 || slice.energy >= 0.18 ? slice.endMs - slice.startMs : 0), 0)
    / Math.max(1, sectionEndMs - sectionStartMs);
  if (totalActivityMass <= 0 || activeEvidence < 0.12) {
    return interpolateLyricLineTimings(sectionStartMs, sectionEndMs, ordered);
  }

  const lineWeights = ordered.map(lineWeight);
  const totalLineWeight = lineWeights.reduce((sum, weight) => sum + weight, 0);
  const cumulativeTargets: number[] = [];
  let cumulative = 0;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    cumulative += lineWeights[index] / totalLineWeight;
    cumulativeTargets.push(cumulative * totalActivityMass);
  }

  const boundaries = [sectionStartMs];
  let massCursor = 0;
  let targetIndex = 0;
  for (const slice of weightedSlices) {
    if (targetIndex >= cumulativeTargets.length) break;
    const nextMass = massCursor + slice.mass;
    while (targetIndex < cumulativeTargets.length && cumulativeTargets[targetIndex] <= nextMass) {
      const within = slice.mass > 0 ? (cumulativeTargets[targetIndex] - massCursor) / slice.mass : 0;
      const candidate = Math.round(slice.startMs + clamp01(within) * (slice.endMs - slice.startMs));
      const previous = boundaries.at(-1) ?? sectionStartMs;
      const minimumGap = Math.min(180, Math.max(70, Math.floor((sectionEndMs - sectionStartMs) / Math.max(20, ordered.length * 4))));
      boundaries.push(Math.max(previous + minimumGap, Math.min(sectionEndMs - 1, candidate)));
      targetIndex += 1;
    }
    massCursor = nextMass;
  }
  while (boundaries.length < ordered.length) {
    const fallback = interpolateLyricLineTimings(sectionStartMs, sectionEndMs, ordered);
    boundaries.push(fallback[boundaries.length]?.startMs ?? sectionEndMs - 1);
  }
  boundaries.push(sectionEndMs);

  // Repair any compressed tail caused by very concentrated activity while preserving order.
  for (let index = boundaries.length - 2; index > 0; index -= 1) {
    boundaries[index] = Math.min(boundaries[index], boundaries[index + 1] - 1);
  }
  for (let index = 1; index < boundaries.length - 1; index += 1) {
    boundaries[index] = Math.max(boundaries[index], boundaries[index - 1] + 1);
  }

  return ordered.map((line, index) => ({
    id: line.id,
    startMs: boundaries[index],
    endMs: Math.max(boundaries[index] + 1, boundaries[index + 1]),
  }));
}

export function normalizeExcerpt(value: string) {
  return value
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
