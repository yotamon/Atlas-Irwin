import type { ArtistMemoryItem } from "./domain";

export type RankableMoment = {
  id: string;
  label?: string | null;
  moment_type?: string | null;
  purpose_tags?: string[] | null;
  start_ms?: number | null;
  end_ms?: number | null;
  state?: string | null;
};

const NEGATIVE_TERMS = /\b(avoid|poor|weak|underperform|discourag|reject|skip)\w*/i;

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
}

function memoryDelta(moment: RankableMoment, memories: ArtistMemoryItem[]) {
  const momentTokens = tokens([
    moment.label ?? "",
    moment.moment_type ?? "",
    ...(moment.purpose_tags ?? []),
  ].join(" "));
  if (!momentTokens.size) return 0;

  let delta = 0;
  for (const memory of memories) {
    // Exact Moment calibration already participates in canonical curation. Do not
    // count it again through generalized Artist Memory.
    if (memory.source.kind === "moment_calibration") continue;
    const memoryText = `${memory.title} ${memory.value}`;
    const memoryTokens = tokens(memoryText);
    let overlap = 0;
    for (const token of memoryTokens) {
      if (momentTokens.has(token)) overlap += 1;
    }
    if (!overlap) continue;

    const confidence = Math.max(0, Math.min(1, memory.confidence.score));
    const explicitMultiplier = memory.confidence.label === "explicit" ? 1.5 : 1;
    const direction = NEGATIVE_TERMS.test(memoryText) ? -1 : 1;
    delta += direction * Math.min(0.04, overlap * 0.012 * confidence * explicitMultiplier);
  }
  return Math.max(-0.04, Math.min(0.04, delta));
}

export function rankMomentsWithArtistMemory<T extends RankableMoment>(
  moments: readonly T[],
  memories: readonly ArtistMemoryItem[],
): T[] {
  if (moments.length < 2 || !memories.length) return [...moments];

  return moments
    .map((moment, index) => ({ moment, index, delta: memoryDelta(moment, [...memories]) }))
    .sort((left, right) => right.delta - left.delta || left.index - right.index)
    .map(({ moment }) => moment);
}
