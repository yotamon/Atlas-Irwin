export const DJ_LIBRARY_CONTRACT_VERSION = "ensemblis.dj-library-source.v1" as const;
export const SOURCE_CONTRACT_VERSION = "ensemblis.automix-source.v1" as const;
export const AUTOMIX_SOURCE_REF_VERSION = SOURCE_CONTRACT_VERSION;

export type AutoMixSourceKind =
  | "artist_catalog"
  | "local_library"
  | "rekordbox"
  | "traktor";

export type AutoMixExecutionTarget = "cloud" | "device";
export type AutoMixSourceAvailability = "available" | "offline" | "missing" | "unknown";
export type DjLibraryDetectionStatus = "available" | "unavailable" | "permission_required" | "unsupported";

export type AutoMixSourceTrackRef = {
  version: typeof AUTOMIX_SOURCE_REF_VERSION;
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
  exportPlaylists?: boolean;
};

export type AutoMixSourceDescriptor = {
  kind: AutoMixSourceKind;
  displayName: string;
  executionTarget: AutoMixExecutionTarget;
  capabilities: AutoMixSourceCapabilities;
};

export type DjLibrarySourceIdentity = {
  sourceId: string;
  kind: AutoMixSourceKind;
  displayName: string;
  revision: string | null;
};

export type DjLibraryDetection = {
  status: DjLibraryDetectionStatus;
  source: DjLibrarySourceIdentity | null;
  reason?: string | null;
};

export type DjLibraryTrackMetadata = {
  title: string;
  artist: string | null;
  album?: string | null;
  remix?: string | null;
  genre?: string | null;
  comments?: string | null;
  durationMs?: number | null;
  bpm?: number | null;
  musicalKey?: string | null;
  rating?: number | null;
  color?: string | null;
  tags?: readonly string[];
  year?: number | null;
};

export type DjLibraryAnalysisProvenance = {
  field: "bpm" | "key" | "grid" | "cue" | "metadata" | "history" | "fingerprint";
  source: string;
  confidence?: number | null;
  revision?: string | null;
};

export type DjLibraryCuePoint = {
  id: string;
  positionMs: number;
  kind: "cue" | "hot_cue" | "loop" | "memory" | "unknown";
  name?: string | null;
  color?: string | null;
  endPositionMs?: number | null;
};

export type DjLibraryBeatGrid = {
  bpm: number;
  firstBeatMs: number;
  beatsPerBar: number;
  confidence?: number | null;
  variableTempo?: boolean;
};

export type DjLibraryPlaylist = {
  id: string;
  sourceId: string;
  name: string;
  parentId?: string | null;
  trackIds: readonly string[];
  kind?: "playlist" | "crate" | "history" | "folder";
  revision?: string | null;
};

export type DjLibraryPlayHistoryEntry = {
  id: string;
  sourceId: string;
  trackId: string;
  playedAt?: string | null;
  context?: string | null;
  position?: number | null;
};

export type NormalizedDjLibraryTrack = {
  version: typeof DJ_LIBRARY_CONTRACT_VERSION;
  stableId: string;
  source: AutoMixSourceTrackRef;
  sourceTrackId: string;
  recordingFingerprint?: string | null;
  metadata: DjLibraryTrackMetadata;
  playlistIds: readonly string[];
  cuePoints: readonly DjLibraryCuePoint[];
  beatGrid?: DjLibraryBeatGrid | null;
  analysisProvenance: readonly DjLibraryAnalysisProvenance[];
  canonicalTrackId?: string | null;
  trackIntelligenceFingerprint?: string | null;
};

export type DjLibraryScanResult = {
  source: DjLibrarySourceIdentity;
  tracks: readonly NormalizedDjLibraryTrack[];
  playlists: readonly DjLibraryPlaylist[];
  revision: string;
};

export interface DjLibrarySourceAdapter<TContext = unknown> {
  readonly descriptor: AutoMixSourceDescriptor;
  detect(context: TContext): Promise<DjLibraryDetection>;
  describeSource(context: TContext): Promise<DjLibrarySourceIdentity>;
  scanTracks(context: TContext): Promise<readonly NormalizedDjLibraryTrack[]>;
  scanPlaylists(context: TContext): Promise<readonly DjLibraryPlaylist[]>;
  readTrackMetadata(context: TContext, trackId: string): Promise<DjLibraryTrackMetadata | null>;
  readCuePoints(context: TContext, trackId: string): Promise<readonly DjLibraryCuePoint[]>;
  readBeatGrid(context: TContext, trackId: string): Promise<DjLibraryBeatGrid | null>;
  readPlayHistory(context: TContext): Promise<readonly DjLibraryPlayHistoryEntry[]>;
  getRevision(context: TContext): Promise<string>;
}

/**
 * Backwards-compatible minimal resolver used by current catalog-backed AutoMix callers.
 * New external-library integrations should implement DjLibrarySourceAdapter instead.
 */
export interface AutoMixSourceAdapter<TContext = unknown, TTrack = unknown> {
  readonly descriptor: AutoMixSourceDescriptor;
  resolveTracks(context: TContext, trackIds: readonly string[]): Promise<TTrack[]>;
}

const SOURCE_KINDS = new Set<AutoMixSourceKind>([
  "artist_catalog",
  "local_library",
  "rekordbox",
  "traktor",
]);

export function artistCatalogSourceRef(trackId: string): AutoMixSourceTrackRef {
  return {
    version: AUTOMIX_SOURCE_REF_VERSION,
    kind: "artist_catalog",
    trackId,
    executionTarget: "cloud",
    availability: "available",
  };
}

export function sourceStableTrackId(kind: AutoMixSourceKind, sourceId: string, sourceTrackId: string) {
  return `${kind}:${sourceId}:${sourceTrackId}`;
}

export function normalizeAutoMixSourceRef(value: unknown): AutoMixSourceTrackRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // Once a caller declares a contract version, never silently reinterpret another version as v1.
  if (raw.version !== undefined && raw.version !== SOURCE_CONTRACT_VERSION) return null;
  const kind = raw.kind;
  const trackId = typeof raw.trackId === "string" ? raw.trackId.trim() : "";
  const executionTarget = raw.executionTarget;
  if (typeof kind !== "string" || !SOURCE_KINDS.has(kind as AutoMixSourceKind) || !trackId) return null;
  if (executionTarget !== "cloud" && executionTarget !== "device") return null;
  const availability = ["available", "offline", "missing", "unknown"].includes(String(raw.availability))
    ? raw.availability as AutoMixSourceAvailability
    : "unknown";
  return {
    version: AUTOMIX_SOURCE_REF_VERSION,
    kind: kind as AutoMixSourceKind,
    trackId,
    executionTarget,
    librarySourceId: typeof raw.librarySourceId === "string" ? raw.librarySourceId : null,
    recordingFingerprint: typeof raw.recordingFingerprint === "string" ? raw.recordingFingerprint : null,
    revision: typeof raw.revision === "string" ? raw.revision : null,
    availability,
  };
}

export function normalizeDjLibraryTrack(value: NormalizedDjLibraryTrack): NormalizedDjLibraryTrack {
  const stableId = value.stableId.trim();
  const sourceTrackId = value.sourceTrackId.trim();
  if (!stableId || !sourceTrackId) throw new Error("DJ library tracks require stable source-neutral identity.");
  if (value.version !== DJ_LIBRARY_CONTRACT_VERSION) throw new Error("Unsupported DJ library contract version.");
  if (value.source.availability === "missing") {
    return { ...value, stableId, sourceTrackId };
  }
  if (value.metadata.durationMs != null && value.metadata.durationMs < 0) {
    throw new Error("DJ library track duration cannot be negative.");
  }
  return { ...value, stableId, sourceTrackId };
}
