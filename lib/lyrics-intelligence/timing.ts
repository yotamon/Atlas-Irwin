import type { MusicMapSection } from "@/lib/video-director/creative-director";
import type { TrackLyricSection } from "@/types/lyrics-database";

export type VocalSectionActivity = {
  activeRatio: number;
  energy: number;
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
  const weights = ordered.map((line) => Math.max(1.5, Math.sqrt(wordCount(line.text)) + line.text.length / 42));
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

export function normalizeExcerpt(value: string) {
  return value
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
