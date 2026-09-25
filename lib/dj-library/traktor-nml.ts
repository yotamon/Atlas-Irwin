import type {
  AutoMixSourceDescriptor,
  DjLibraryAnalysisProvenance,
  DjLibraryBeatGrid,
  DjLibraryCuePoint,
  DjLibraryDetection,
  DjLibraryPlayHistoryEntry,
  DjLibraryPlaylist,
  DjLibrarySourceAdapter,
  DjLibrarySourceIdentity,
  DjLibraryTrackMetadata,
  NormalizedDjLibraryTrack,
} from "../automix/source-contract";
import {
  DJ_LIBRARY_CONTRACT_VERSION,
  SOURCE_CONTRACT_VERSION,
  sourceStableTrackId,
} from "../automix/source-contract";

export const TRAKTOR_NML_ADAPTER_VERSION = "ensemblis.traktor-nml.v1" as const;
const DEFAULT_SOURCE_ID = "traktor-nml";
const MAX_NML_BYTES = 64 * 1024 * 1024;

type Attributes = Record<string, string>;
type RawCue = { attrs: Attributes };
type RawTrack = {
  attrs: Attributes;
  album: Attributes;
  info: Attributes;
  tempo: Attributes[];
  musicalKey: Attributes;
  location: Attributes;
  primaryKey: string | null;
  cues: RawCue[];
  sourceTrackId: string;
};
type RawPlaylist = {
  id: string;
  name: string;
  parentId: string | null;
  kind: "playlist" | "folder" | "history";
  keys: string[];
  path: string;
};

type ParsedTraktor = {
  source: DjLibrarySourceIdentity;
  revision: string;
  tracks: NormalizedDjLibraryTrack[];
  playlists: DjLibraryPlaylist[];
  history: DjLibraryPlayHistoryEntry[];
  rawTracks: RawTrack[];
};

export type TraktorNmlContext = {
  nml: string;
  sourceId?: string;
  displayName?: string;
};

export type TraktorM3uExportInput = {
  playlist: DjLibraryPlaylist;
  tracks: readonly NormalizedDjLibraryTrack[];
  /** Local-only resolver. Filesystem locations must never be persisted in normalized/cloud state. */
  locationForTrack: (track: NormalizedDjLibraryTrack) => string | null | undefined;
};

function finite(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function traktorNmlRevision(nml: string) {
  return `tnml1:${stableHash(nml)}:${nml.length}`;
}

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    const radix = normalized.startsWith("#x") ? 16 : 10;
    const digits = normalized.startsWith("#x") ? normalized.slice(2) : normalized.slice(1);
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(digits, radix);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

function parseAttributes(raw: string): Attributes {
  const attrs: Attributes = {};
  const body = raw.replace(/^\s*[^\s/>]+/, "");
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of body.matchAll(pattern)) attrs[match[1]] = decodeXml(match[3] ?? match[4] ?? "");
  return attrs;
}

function validateNmlInput(nml: string) {
  if (typeof nml !== "string" || !nml.trim()) throw new Error("Traktor NML is empty.");
  if (nml.length > MAX_NML_BYTES) throw new Error("Traktor NML exceeds the 64 MiB import safety limit.");
  if (/<!DOCTYPE|<!ENTITY/i.test(nml)) throw new Error("Traktor NML with DTD/entity declarations is not accepted.");
  if (!/<NML\b/i.test(nml) || !/<COLLECTION\b/i.test(nml)) {
    throw new Error("This is not a supported Traktor NML collection or playlist export.");
  }
}

function locationLookupKey(attrs: Attributes) {
  const volume = attrs.VOLUME?.trim() || "";
  const dir = attrs.DIR?.trim() || "";
  const file = attrs.FILE?.trim() || "";
  return [volume, dir, file].join("\u001f");
}

function trackIdentity(track: Omit<RawTrack, "sourceTrackId">) {
  const audioId = track.attrs.AUDIO_ID?.trim();
  if (audioId) return `audio-${stableHash(audioId)}`;
  if (track.primaryKey) return `key-${stableHash(track.primaryKey)}`;
  const locationKey = locationLookupKey(track.location);
  if (track.location.FILE && locationKey) return `location-${stableHash(locationKey)}`;
  const metadata = [
    track.attrs.TITLE,
    track.attrs.ARTIST,
    track.album.TITLE,
    track.info.PLAYTIME,
    track.tempo[0]?.BPM,
    track.musicalKey.VALUE,
  ].join("\u001f");
  return `metadata-${stableHash(metadata)}`;
}

const KEY_LABELS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"] as const;
const MAJOR_CAMELOT = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"] as const;
const MINOR_CAMELOT = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"] as const;

function traktorKey(value: string | undefined) {
  const raw = finite(value);
  if (raw == null || !Number.isInteger(raw) || raw < 0 || raw > 23) return null;
  const rootPc = raw % 12;
  const mode = raw >= 12 ? "minor" : "major";
  const label = `${KEY_LABELS[rootPc]} ${mode}`;
  return {
    rootPc,
    mode,
    label,
    camelot: mode === "major" ? MAJOR_CAMELOT[rootPc] : MINOR_CAMELOT[rootPc],
  } as const;
}

function metadataFromTrack(track: RawTrack): DjLibraryTrackMetadata {
  const playtime = finite(track.info.PLAYTIME);
  const bpm = finite(track.tempo[0]?.BPM);
  const ranking = finite(track.info.RANKING);
  const releaseDate = track.info.RELEASE_DATE?.trim() || "";
  const yearMatch = releaseDate.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  const key = traktorKey(track.musicalKey.VALUE);
  return {
    title: track.attrs.TITLE?.trim() || "Untitled",
    artist: track.attrs.ARTIST?.trim() || null,
    album: track.album.TITLE?.trim() || null,
    remix: track.info.REMIXER?.trim() || null,
    genre: track.info.GENRE?.trim() || null,
    comments: track.info.COMMENT?.trim() || null,
    durationMs: playtime == null ? null : Math.max(0, Math.round(playtime * 1000)),
    bpm: bpm != null && bpm > 0 ? bpm : null,
    musicalKey: key?.camelot ?? key?.label ?? null,
    rating: ranking == null ? null : clamp(Math.round(ranking > 5 ? ranking / 51 : ranking), 0, 5),
    color: track.info.COLOR?.trim() || null,
    tags: track.info.LABEL?.trim() ? [track.info.LABEL.trim()] : [],
    year: yearMatch ? Number(yearMatch[1]) : null,
  };
}

function cuePoints(track: RawTrack): DjLibraryCuePoint[] {
  return track.cues.flatMap((cue, index) => {
    const attrs = cue.attrs;
    const start = finite(attrs.START);
    if (start == null || start < 0) return [];
    const type = Number.parseInt(attrs.TYPE || "-1", 10);
    const hotCue = Number.parseInt(attrs.HOTCUE || "-1", 10);
    if (type === 4 && hotCue < 0) return [];
    const length = finite(attrs.LEN);
    const kind: DjLibraryCuePoint["kind"] = type === 5
      ? "loop"
      : hotCue >= 0
        ? "hot_cue"
        : "memory";
    return [{
      id: `${track.sourceTrackId}:cue:${index}`,
      positionMs: Math.round(start),
      kind,
      name: attrs.NAME?.trim() || null,
      color: attrs.COLOR?.trim() || null,
      endPositionMs: type === 5 && length != null && length > 0 ? Math.round(start + length) : null,
    }];
  });
}

function beatGrid(track: RawTrack): DjLibraryBeatGrid | null {
  const tempos = track.tempo.map((item) => finite(item.BPM)).filter((value): value is number => value != null && value > 0);
  if (!tempos.length) return null;
  const gridMarkers = track.cues
    .filter((cue) => Number.parseInt(cue.attrs.TYPE || "-1", 10) === 4)
    .map((cue) => finite(cue.attrs.START))
    .filter((value): value is number => value != null && value >= 0)
    .sort((a, b) => a - b);
  const quality = finite(track.tempo[0]?.BPM_QUALITY);
  const confidence = quality == null ? 0.9 : clamp(quality > 1 ? quality / 100 : quality, 0, 1);
  const distinct = new Set(tempos.map((value) => Math.round(value * 100) / 100));
  return {
    bpm: tempos[0],
    firstBeatMs: Math.round(gridMarkers[0] ?? 0),
    beatsPerBar: 4,
    confidence,
    variableTempo: distinct.size > 1,
  };
}

function isHistoryPath(path: string) {
  return /(^|[/>\s_-])history([/>\s_-]|$)/i.test(path);
}

function parseRawNml(nml: string) {
  validateNmlInput(nml);
  const rawTracks: RawTrack[] = [];
  const rawPlaylists: RawPlaylist[] = [];
  const primaryKeyToTrack = new Map<string, string>();
  let section: "collection" | "playlists" | null = null;
  let currentTrack: Omit<RawTrack, "sourceTrackId"> | null = null;
  const playlistStack: RawPlaylist[] = [];

  const tagPattern = /<([^<>]+)>/g;
  for (const tokenMatch of nml.matchAll(tagPattern)) {
    let token = tokenMatch[1].trim();
    if (!token || token.startsWith("?") || token.startsWith("!")) continue;
    const closing = token.startsWith("/");
    if (closing) token = token.slice(1).trim();
    const selfClosing = token.endsWith("/");
    if (selfClosing) token = token.slice(0, -1).trim();
    const name = token.split(/\s+/, 1)[0].toUpperCase();
    const attrs = closing ? {} : parseAttributes(token);

    if (name === "COLLECTION") {
      section = closing ? null : "collection";
      continue;
    }
    if (name === "PLAYLISTS") {
      section = closing ? null : "playlists";
      continue;
    }

    if (section === "collection") {
      if (name === "ENTRY" && !closing) {
        currentTrack = { attrs, album: {}, info: {}, tempo: [], musicalKey: {}, location: {}, primaryKey: null, cues: [] };
        continue;
      }
      if (name === "ENTRY" && closing && currentTrack) {
        const sourceTrackId = trackIdentity(currentTrack);
        const track: RawTrack = { ...currentTrack, sourceTrackId };
        rawTracks.push(track);
        if (track.primaryKey) primaryKeyToTrack.set(track.primaryKey, sourceTrackId);
        const locationKey = locationLookupKey(track.location);
        if (track.location.FILE && locationKey) primaryKeyToTrack.set(locationKey, sourceTrackId);
        currentTrack = null;
        continue;
      }
      if (!currentTrack || closing) continue;
      if (name === "LOCATION") currentTrack.location = attrs;
      else if (name === "ALBUM") currentTrack.album = attrs;
      else if (name === "INFO") currentTrack.info = attrs;
      else if (name === "TEMPO") currentTrack.tempo.push(attrs);
      else if (name === "MUSICAL_KEY") currentTrack.musicalKey = attrs;
      else if (name === "CUE_V2") currentTrack.cues.push({ attrs });
      else if (name === "PRIMARYKEY") currentTrack.primaryKey = attrs.KEY?.trim() || null;
      continue;
    }

    if (section === "playlists") {
      if (name === "NODE" && !closing) {
        const parent = playlistStack.at(-1) ?? null;
        const nodeName = attrs.NAME?.trim() || "Untitled";
        const path = parent ? `${parent.path}/${nodeName}` : nodeName;
        const nodeType = attrs.TYPE?.toUpperCase() || "FOLDER";
        const raw: RawPlaylist = {
          id: `traktor:${stableHash(path)}`,
          name: nodeName,
          parentId: parent?.id ?? null,
          kind: nodeType === "PLAYLIST" ? (isHistoryPath(path) ? "history" : "playlist") : "folder",
          keys: [],
          path,
        };
        rawPlaylists.push(raw);
        if (!selfClosing) playlistStack.push(raw);
        continue;
      }
      if (name === "NODE" && closing) {
        playlistStack.pop();
        continue;
      }
      if (name === "PRIMARYKEY" && !closing) {
        const playlist = playlistStack.at(-1);
        if (playlist && attrs.KEY) playlist.keys.push(attrs.KEY);
      }
    }
  }

  if (currentTrack) throw new Error("Malformed Traktor NML: unclosed COLLECTION ENTRY element.");
  const trackIds = new Set(rawTracks.map((track) => track.sourceTrackId));
  const playlists: DjLibraryPlaylist[] = rawPlaylists.map((playlist) => ({
    id: playlist.id,
    sourceId: "",
    name: playlist.name,
    parentId: playlist.parentId,
    trackIds: playlist.keys.flatMap((key) => {
      const direct = primaryKeyToTrack.get(key);
      if (direct && trackIds.has(direct)) return [direct];
      return [];
    }),
    kind: playlist.kind,
    revision: null,
  }));
  return { rawTracks, playlists };
}

export function parseTraktorNml(context: TraktorNmlContext): ParsedTraktor {
  const sourceId = context.sourceId?.trim() || DEFAULT_SOURCE_ID;
  const revision = traktorNmlRevision(context.nml);
  const parsed = parseRawNml(context.nml);
  const source: DjLibrarySourceIdentity = {
    sourceId,
    kind: "traktor",
    displayName: context.displayName?.trim() || "Traktor NML",
    revision,
  };
  const playlists = parsed.playlists.map((playlist) => ({ ...playlist, sourceId, revision }));
  const playlistIdsByTrack = new Map<string, string[]>();
  for (const playlist of playlists) {
    for (const trackId of playlist.trackIds) {
      const ids = playlistIdsByTrack.get(trackId) ?? [];
      ids.push(playlist.id);
      playlistIdsByTrack.set(trackId, ids);
    }
  }

  const tracks: NormalizedDjLibraryTrack[] = parsed.rawTracks.map((raw) => {
    const metadata = metadataFromTrack(raw);
    const cues = cuePoints(raw);
    const grid = beatGrid(raw);
    const provenance: DjLibraryAnalysisProvenance[] = [
      { field: "metadata", source: TRAKTOR_NML_ADAPTER_VERSION, confidence: 1, revision },
    ];
    if (metadata.bpm != null) provenance.push({ field: "bpm", source: TRAKTOR_NML_ADAPTER_VERSION, confidence: 0.95, revision });
    if (metadata.musicalKey) provenance.push({ field: "key", source: TRAKTOR_NML_ADAPTER_VERSION, confidence: 0.9, revision });
    if (grid) provenance.push({ field: "grid", source: TRAKTOR_NML_ADAPTER_VERSION, confidence: grid.confidence ?? 0.9, revision });
    if (cues.length) provenance.push({ field: "cue", source: TRAKTOR_NML_ADAPTER_VERSION, confidence: 1, revision });
    return {
      version: DJ_LIBRARY_CONTRACT_VERSION,
      stableId: sourceStableTrackId("traktor", sourceId, raw.sourceTrackId),
      source: {
        version: SOURCE_CONTRACT_VERSION,
        kind: "traktor",
        trackId: raw.sourceTrackId,
        executionTarget: "device",
        librarySourceId: sourceId,
        recordingFingerprint: null,
        revision,
        availability: raw.location.FILE ? "available" : "missing",
      },
      sourceTrackId: raw.sourceTrackId,
      recordingFingerprint: null,
      metadata,
      playlistIds: playlistIdsByTrack.get(raw.sourceTrackId) ?? [],
      cuePoints: cues,
      beatGrid: grid,
      analysisProvenance: provenance,
      canonicalTrackId: null,
      trackIntelligenceFingerprint: null,
    };
  });

  const history: DjLibraryPlayHistoryEntry[] = [];
  for (const playlist of playlists.filter((item) => item.kind === "history")) {
    playlist.trackIds.forEach((trackId, position) => history.push({
      id: `${playlist.id}:play:${position}:${trackId}`,
      sourceId,
      trackId,
      playedAt: null,
      context: playlist.name,
      position,
    }));
  }
  return { source, revision, tracks, playlists, history, rawTracks: parsed.rawTracks };
}

export class TraktorNmlSourceAdapter implements DjLibrarySourceAdapter<TraktorNmlContext> {
  readonly descriptor: AutoMixSourceDescriptor = {
    kind: "traktor",
    displayName: "Traktor NML",
    executionTarget: "device",
    capabilities: {
      readAudio: false,
      readPlaylists: true,
      readCuePoints: true,
      readBeatGrid: true,
      readHistory: true,
      renderLocally: false,
      exportPlaylists: true,
    },
  };

  async detect(context: TraktorNmlContext): Promise<DjLibraryDetection> {
    try {
      return { status: "available", source: parseTraktorNml(context).source };
    } catch (error) {
      return { status: "unavailable", source: null, reason: error instanceof Error ? error.message : "Invalid Traktor NML." };
    }
  }
  async describeSource(context: TraktorNmlContext) { return parseTraktorNml(context).source; }
  async scanTracks(context: TraktorNmlContext) { return parseTraktorNml(context).tracks; }
  async scanPlaylists(context: TraktorNmlContext) { return parseTraktorNml(context).playlists; }
  async readTrackMetadata(context: TraktorNmlContext, trackId: string) {
    return parseTraktorNml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.metadata ?? null;
  }
  async readCuePoints(context: TraktorNmlContext, trackId: string) {
    return parseTraktorNml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.cuePoints ?? [];
  }
  async readBeatGrid(context: TraktorNmlContext, trackId: string) {
    return parseTraktorNml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.beatGrid ?? null;
  }
  async readPlayHistory(context: TraktorNmlContext) { return parseTraktorNml(context).history; }
  async getRevision(context: TraktorNmlContext) { return traktorNmlRevision(context.nml); }
}

export function exportTraktorM3u(input: TraktorM3uExportInput) {
  const byId = new Map(input.tracks.map((track) => [track.sourceTrackId, track]));
  const lines = ["#EXTM3U"];
  for (const trackId of input.playlist.trackIds) {
    const track = byId.get(trackId);
    if (!track) continue;
    const location = input.locationForTrack(track)?.trim() || "";
    if (!location || /[\r\n]/.test(location)) throw new Error(`Traktor M3U export requires a valid local path for ${track.metadata.title}.`);
    const duration = track.metadata.durationMs == null ? -1 : Math.round(track.metadata.durationMs / 1000);
    lines.push(`#EXTINF:${duration},${track.metadata.artist ? `${track.metadata.artist} - ` : ""}${track.metadata.title}`);
    lines.push(location);
  }
  return `${lines.join("\n")}\n`;
}
