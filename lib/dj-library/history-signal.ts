import type {
  DjLibraryPlayHistoryEntry,
  NormalizedDjLibraryTrack,
} from "../automix/source-contract";

export const DJ_LIBRARY_HISTORY_OBSERVATION_VERSION = "ensemblis.dj-library-history-observation.v1" as const;

export type DjLibraryHistoryObservation = {
  version: typeof DJ_LIBRARY_HISTORY_OBSERVATION_VERSION;
  sampleCount: number;
  orderedPairCount: number;
  tempoMovement: number | null;
  harmonicAdventure: number | null;
};

export type DjLibraryHistoryPreferenceSignal = {
  harmonicAdventure: number;
  transitionAggressiveness: number;
  exploration: number;
  tempoMovement: number;
  energyDynamics: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

type WheelKey = { number: number; mode: "A" | "B" };

const MAJOR_CAMELOT: Record<string, number> = {
  C: 8, G: 9, D: 10, A: 11, E: 12, B: 1,
  "F#": 2, GB: 2, DB: 3, "C#": 3, AB: 4, "G#": 4,
  EB: 5, "D#": 5, BB: 6, "A#": 6, F: 7,
};
const MINOR_CAMELOT: Record<string, number> = {
  A: 8, E: 9, B: 10, "F#": 11, GB: 11, "C#": 12, DB: 12,
  "G#": 1, AB: 1, "D#": 2, EB: 2, BB: 3, "A#": 3,
  F: 4, C: 5, G: 6, D: 7,
};

function normalizedPitch(value: string) {
  return value.trim().toUpperCase().replaceAll("♯", "#").replaceAll("♭", "B");
}

function parseWheelKey(value: string | null | undefined): WheelKey | null {
  if (!value) return null;
  const compact = normalizedPitch(value).replace(/\s+/g, "");
  const camelot = compact.match(/^(1[0-2]|[1-9])([AB])$/);
  if (camelot) return { number: Number(camelot[1]), mode: camelot[2] as "A" | "B" };

  const minor = /(?:M|MIN|MINOR)$/.test(compact) && !/(?:MAJ|MAJOR)$/.test(compact);
  const root = compact
    .replace(/(?:MINOR|MIN|MAJOR|MAJ|M)$/, "")
    .replace(/^([A-G])B$/, "$1B");
  const number = (minor ? MINOR_CAMELOT : MAJOR_CAMELOT)[root];
  return number ? { number, mode: minor ? "A" : "B" } : null;
}

function harmonicMovement(a: WheelKey, b: WheelKey) {
  const raw = Math.abs(a.number - b.number);
  const circular = Math.min(raw, 12 - raw);
  const modePenalty = a.mode === b.mode ? 0 : 0.75;
  // Same/relative/adjacent harmonic choices stay conservative; large wheel jumps approach 1.
  return clamp01((circular + modePenalty) / 6);
}

export function observeDjLibraryHistory(
  tracks: readonly NormalizedDjLibraryTrack[],
  history: readonly DjLibraryPlayHistoryEntry[],
): DjLibraryHistoryObservation {
  const byId = new Map<string, NormalizedDjLibraryTrack>();
  for (const track of tracks) {
    byId.set(track.sourceTrackId, track);
    byId.set(track.stableId, track);
  }
  const ordered = [...history]
    .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
    .flatMap((entry) => {
      const track = byId.get(entry.trackId);
      return track ? [track] : [];
    });

  const tempoMovements: number[] = [];
  const harmonicMovements: number[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const currentBpm = current.metadata.bpm;
    const nextBpm = next.metadata.bpm;
    if (typeof currentBpm === "number" && currentBpm > 0 && typeof nextBpm === "number" && nextBpm > 0) {
      tempoMovements.push(clamp01(Math.abs(nextBpm - currentBpm) / currentBpm / 0.12));
    }
    const currentKey = parseWheelKey(current.metadata.musicalKey);
    const nextKey = parseWheelKey(next.metadata.musicalKey);
    if (currentKey && nextKey) harmonicMovements.push(harmonicMovement(currentKey, nextKey));
  }

  return {
    version: DJ_LIBRARY_HISTORY_OBSERVATION_VERSION,
    sampleCount: ordered.length,
    orderedPairCount: Math.max(0, ordered.length - 1),
    tempoMovement: mean(tempoMovements),
    harmonicAdventure: mean(harmonicMovements),
  };
}

export function preferenceSignalFromHistoryObservation(value: unknown): {
  observation: DjLibraryHistoryObservation;
  signal: DjLibraryHistoryPreferenceSignal;
  weight: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid DJ library history observation.");
  const raw = value as Record<string, unknown>;
  if (raw.version !== DJ_LIBRARY_HISTORY_OBSERVATION_VERSION) throw new Error("Unsupported DJ library history observation version.");
  const sampleCount = Number(raw.sampleCount);
  const orderedPairCount = Number(raw.orderedPairCount);
  if (!Number.isInteger(sampleCount) || sampleCount < 0 || sampleCount > 100000) throw new Error("Invalid history sample count.");
  if (!Number.isInteger(orderedPairCount) || orderedPairCount < 0 || orderedPairCount > sampleCount) throw new Error("Invalid history pair count.");

  const boundedOptional = (candidate: unknown) => {
    if (candidate === null || candidate === undefined) return null;
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 1) {
      throw new Error("DJ history observations must be normalized to 0..1.");
    }
    return candidate;
  };
  const observation: DjLibraryHistoryObservation = {
    version: DJ_LIBRARY_HISTORY_OBSERVATION_VERSION,
    sampleCount,
    orderedPairCount,
    tempoMovement: boundedOptional(raw.tempoMovement),
    harmonicAdventure: boundedOptional(raw.harmonicAdventure),
  };

  const signal: DjLibraryHistoryPreferenceSignal = {
    harmonicAdventure: observation.harmonicAdventure ?? 0.5,
    transitionAggressiveness: 0.5,
    exploration: 0.45,
    tempoMovement: observation.tempoMovement ?? 0.42,
    energyDynamics: 0.52,
  };
  // History is weaker than explicit edits/approvals. More observations improve reliability slowly,
  // and the persistence layer enforces an additional 0.4 per-row / 1.5 aggregate cap.
  const weight = clamp01(Math.min(0.35, 0.06 + Math.log1p(orderedPairCount) * 0.055));
  return { observation, signal, weight };
}
