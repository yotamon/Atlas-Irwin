export type AutoMixSourceKind =
  | "artist_catalog"
  | "local_library"
  | "rekordbox"
  | "serato"
  | "traktor";

export type AutoMixExecutionTarget = "cloud" | "device";
export type AutoMixSourceAvailability = "available" | "offline" | "missing" | "unknown";

export type AutoMixSourceTrackRef = {
  version: "ensemblis.automix-source.v1";
  kind: AutoMixSourceKind;
  trackId: string;
  executionTarget: AutoMixExecutionTarget;
  librarySourceId?: string | null;
  recordingFingerprint?: string | null;
  revision?: string | null;
  availability?: AutoMixSourceAvailability;
};

export type AutoMixSourceCapabilities = {
  readAudio: boolean;
  readPlaylists: boolean;
  readCuePoints: boolean;
  readBeatGrid: boolean;
  readHistory: boolean;
  renderLocally: boolean;
};

export type AutoMixSourceDescriptor = {
  kind: AutoMixSourceKind;
  displayName: string;
  executionTarget: AutoMixExecutionTarget;
  capabilities: AutoMixSourceCapabilities;
};

export interface AutoMixSourceAdapter<TContext = unknown, TTrack = unknown> {
  readonly descriptor: AutoMixSourceDescriptor;
  resolveTracks(context: TContext, trackIds: readonly string[]): Promise<TTrack[]>;
}

const SOURCE_KINDS = new Set<AutoMixSourceKind>([
  "artist_catalog",
  "local_library",
  "rekordbox",
  "serato",
  "traktor",
]);

export function artistCatalogSourceRef(trackId: string): AutoMixSourceTrackRef {
  return {
    version: "ensemblis.automix-source.v1",
    kind: "artist_catalog",
    trackId,
    executionTarget: "cloud",
    availability: "available",
  };
}

export function normalizeAutoMixSourceRef(value: unknown): AutoMixSourceTrackRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  const trackId = typeof raw.trackId === "string" ? raw.trackId.trim() : "";
  const executionTarget = raw.executionTarget;
  if (typeof kind !== "string" || !SOURCE_KINDS.has(kind as AutoMixSourceKind) || !trackId) return null;
  if (executionTarget !== "cloud" && executionTarget !== "device") return null;
  const availability = ["available", "offline", "missing", "unknown"].includes(String(raw.availability))
    ? raw.availability as AutoMixSourceAvailability
    : "unknown";
  return {
    version: "ensemblis.automix-source.v1",
    kind: kind as AutoMixSourceKind,
    trackId,
    executionTarget,
    librarySourceId: typeof raw.librarySourceId === "string" ? raw.librarySourceId : null,
    recordingFingerprint: typeof raw.recordingFingerprint === "string" ? raw.recordingFingerprint : null,
    revision: typeof raw.revision === "string" ? raw.revision : null,
    availability,
  };
}
