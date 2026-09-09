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

export const REKORDBOX_XML_ADAPTER_VERSION = "ensemblis.rekordbox-xml.v1" as const;
const DEFAULT_SOURCE_ID = "rekordbox-xml";
const MAX_XML_BYTES = 64 * 1024 * 1024;

type Attributes = Record<string, string>;
type RawTempo = { attrs: Attributes };
type RawMark = { attrs: Attributes };
type RawTrack = {
  attrs: Attributes;
  tempos: RawTempo[];
  marks: RawMark[];
  sourceTrackId: string;
};
type RawPlaylist = {
  id: string;
  name: string;
  parentId: string | null;
  kind: "playlist" | "folder" | "history";
  keyType: "0" | "1";
  keys: string[];
  path: string;
};

type ParsedRekordbox = {
  source: DjLibrarySourceIdentity;
  revision: string;
  tracks: NormalizedDjLibraryTrack[];
  playlists: DjLibraryPlaylist[];
  history: DjLibraryPlayHistoryEntry[];
  rawTracks: RawTrack[];
};

export type RekordboxXmlContext = {
  xml: string;
  sourceId?: string;
  displayName?: string;
};

export type RekordboxXmlExportInput = {
  tracks: readonly NormalizedDjLibraryTrack[];
  playlists: readonly DjLibraryPlaylist[];
  /**
   * Local-only resolver. Ensemblis intentionally does not persist Rekordbox file locations in
   * normalized/cloud library state. The caller must supply a file URI at export time.
   */
  locationForTrack: (track: NormalizedDjLibraryTrack) => string | null | undefined;
  productName?: string;
  productVersion?: string;
};

function finiteNumber(value: unknown): number | null {
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

export function rekordboxXmlRevision(xml: string) {
  return `rbx1:${stableHash(xml)}:${xml.length}`;
}

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

function encodeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}

function parseAttributes(raw: string): Attributes {
  const attrs: Attributes = {};
  const body = raw.replace(/^\s*[^\s/>]+/, "");
  const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of body.matchAll(pattern)) {
    attrs[match[1]] = decodeXml(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function validateXmlInput(xml: string) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("Rekordbox XML is empty.");
  if (xml.length > MAX_XML_BYTES) throw new Error("Rekordbox XML exceeds the 64 MiB import safety limit.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("Rekordbox XML with DTD/entity declarations is not accepted.");
  }
  if (!/<DJ_PLAYLISTS\b/i.test(xml) || !/<COLLECTION\b/i.test(xml)) {
    throw new Error("This is not a supported Rekordbox DJ_PLAYLISTS XML export.");
  }
}

function rawTrackIdentity(attrs: Attributes) {
  const trackId = attrs.TrackID?.trim();
  if (trackId) return trackId;
  // Rekordbox marks Location as essential but TrackID as optional. Path must never become musical
  // identity, so the fallback deliberately uses a metadata composite rather than Location.
  const metadataIdentity = [
    attrs.Name,
    attrs.Artist,
    attrs.Album,
    attrs.TotalTime,
    attrs.Size,
    attrs.AverageBpm,
    attrs.Tonality,
  ].join("\u001f");
  return `metadata-${stableHash(metadataIdentity)}`;
}

function ratingToStars(value: string | undefined) {
  const rating = finiteNumber(value);
  return rating == null ? null : clamp(Math.round(rating / 51), 0, 5);
}

function rgbColor(attrs: Attributes) {
  const red = finiteNumber(attrs.Red);
  const green = finiteNumber(attrs.Green);
  const blue = finiteNumber(attrs.Blue);
  if (red == null || green == null || blue == null) return null;
  return `rgb(${clamp(Math.round(red), 0, 255)}, ${clamp(Math.round(green), 0, 255)}, ${clamp(Math.round(blue), 0, 255)})`;
}

function metadataFromTrack(track: RawTrack): DjLibraryTrackMetadata {
  const attrs = track.attrs;
  const totalSeconds = finiteNumber(attrs.TotalTime);
  const bpm = finiteNumber(attrs.AverageBpm);
  const year = finiteNumber(attrs.Year);
  const grouping = attrs.Grouping?.trim();
  return {
    title: attrs.Name?.trim() || "Untitled",
    artist: attrs.Artist?.trim() || null,
    album: attrs.Album?.trim() || null,
    remix: attrs.Mix?.trim() || attrs.Remixer?.trim() || null,
    genre: attrs.Genre?.trim() || null,
    comments: attrs.Comments?.trim() || null,
    durationMs: totalSeconds == null ? null : Math.max(0, Math.round(totalSeconds * 1000)),
    bpm: bpm != null && bpm > 0 ? bpm : null,
    musicalKey: attrs.Tonality?.trim() || null,
    rating: ratingToStars(attrs.Rating),
    color: attrs.Colour?.trim() || null,
    tags: grouping ? [grouping] : [],
    year: year != null && year > 0 ? Math.round(year) : null,
  };
}

function beatGridFromTrack(track: RawTrack): DjLibraryBeatGrid | null {
  if (!track.tempos.length) return null;
  const valid = track.tempos.map((tempo) => ({
    bpm: finiteNumber(tempo.attrs.Bpm),
    start: finiteNumber(tempo.attrs.Inizio),
    meter: tempo.attrs.Metro,
  })).filter((tempo) => tempo.bpm != null && tempo.bpm > 0);
  if (!valid.length) return null;
  const first = valid[0];
  const numerator = Number.parseInt(first.meter?.split("/")[0] || "4", 10);
  const distinctBpm = new Set(valid.map((tempo) => Math.round((tempo.bpm ?? 0) * 100) / 100));
  return {
    bpm: first.bpm!,
    firstBeatMs: Math.max(0, Math.round((first.start ?? 0) * 1000)),
    beatsPerBar: Number.isFinite(numerator) && numerator > 0 ? numerator : 4,
    confidence: 0.95,
    variableTempo: valid.length > 1 && distinctBpm.size > 1,
  };
}

function cuePointsFromTrack(track: RawTrack): DjLibraryCuePoint[] {
  return track.marks.flatMap((mark, index) => {
    const attrs = mark.attrs;
    const start = finiteNumber(attrs.Start);
    if (start == null || start < 0) return [];
    const type = Number.parseInt(attrs.Type || "-1", 10);
    const number = Number.parseInt(attrs.Num || "-1", 10);
    let kind: DjLibraryCuePoint["kind"] = "unknown";
    if (type === 4) kind = "loop";
    else if (type === 0 && number >= 0) kind = "hot_cue";
    else if (type === 0 && number === -1) kind = "memory";
    else if (type === 0) kind = "cue";
    const end = finiteNumber(attrs.End);
    return [{
      id: `${track.sourceTrackId}:mark:${index}`,
      positionMs: Math.round(start * 1000),
      kind,
      name: attrs.Name?.trim() || null,
      color: rgbColor(attrs),
      endPositionMs: end != null && end >= start ? Math.round(end * 1000) : null,
    }];
  });
}

function isHistoryPath(path: string) {
  return /(^|[/>\s_-])history([/>\s_-]|$)/i.test(path);
}

function parseRawXml(xml: string, sourceId: string) {
  validateXmlInput(xml);
  const rawTracks: RawTrack[] = [];
  const rawPlaylists: RawPlaylist[] = [];
  const locationToTrackId = new Map<string, string>();
  const trackIdToLastPlayed = new Map<string, string | null>();
  let section: "collection" | "playlists" | null = null;
  let currentTrack: RawTrack | null = null;
  const playlistStack: RawPlaylist[] = [];

  const tagPattern = /<([^<>]+)>/g;
  for (const tokenMatch of xml.matchAll(tagPattern)) {
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
      if (name === "TRACK" && !closing) {
        currentTrack = { attrs, tempos: [], marks: [], sourceTrackId: rawTrackIdentity(attrs) };
        if (selfClosing) {
          rawTracks.push(currentTrack);
          if (attrs.Location) locationToTrackId.set(attrs.Location, currentTrack.sourceTrackId);
          trackIdToLastPlayed.set(currentTrack.sourceTrackId, attrs.LastPlayed || null);
          currentTrack = null;
        }
        continue;
      }
      if (name === "TRACK" && closing && currentTrack) {
        rawTracks.push(currentTrack);
        if (currentTrack.attrs.Location) locationToTrackId.set(currentTrack.attrs.Location, currentTrack.sourceTrackId);
        trackIdToLastPlayed.set(currentTrack.sourceTrackId, currentTrack.attrs.LastPlayed || null);
        currentTrack = null;
        continue;
      }
      if (currentTrack && name === "TEMPO" && !closing) currentTrack.tempos.push({ attrs });
      if (currentTrack && name === "POSITION_MARK" && !closing) currentTrack.marks.push({ attrs });
      continue;
    }

    if (section === "playlists") {
      if (name === "NODE" && !closing) {
        const parent = playlistStack.at(-1) ?? null;
        const nodeName = attrs.Name?.trim() || "Untitled";
        const path = parent ? `${parent.path}/${nodeName}` : nodeName;
        const type = attrs.Type === "1" ? "1" : "0";
        const raw: RawPlaylist = {
          id: `rekordbox:${sourceId}:playlist:${stableHash(path)}`,
          name: nodeName,
          parentId: parent?.id ?? null,
          kind: type === "0" ? "folder" : isHistoryPath(path) ? "history" : "playlist",
          keyType: attrs.KeyType === "1" ? "1" : "0",
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
      if (name === "TRACK" && !closing) {
        const playlist = playlistStack.at(-1);
        if (playlist && attrs.Key) playlist.keys.push(attrs.Key);
      }
    }
  }

  if (currentTrack) throw new Error("Malformed Rekordbox XML: unclosed COLLECTION TRACK element.");

  const rawTrackById = new Map(rawTracks.map((track) => [track.sourceTrackId, track]));
  const officialTrackIdToSource = new Map(rawTracks.flatMap((track) => (
    track.attrs.TrackID ? [[track.attrs.TrackID, track.sourceTrackId] as const] : []
  )));
  const resolvedPlaylists: DjLibraryPlaylist[] = rawPlaylists.map((playlist) => ({
    id: playlist.id,
    sourceId,
    name: playlist.name,
    parentId: playlist.parentId,
    trackIds: playlist.keys.flatMap((key) => {
      const sourceTrackId = playlist.keyType === "1" ? locationToTrackId.get(key) : officialTrackIdToSource.get(key);
      return sourceTrackId && rawTrackById.has(sourceTrackId) ? [sourceTrackId] : [];
    }),
    kind: playlist.kind,
    revision: null,
  }));

  const playlistIdsByTrack = new Map<string, string[]>();
  for (const playlist of resolvedPlaylists) {
    for (const trackId of playlist.trackIds) {
      const ids = playlistIdsByTrack.get(trackId) ?? [];
      ids.push(playlist.id);
      playlistIdsByTrack.set(trackId, ids);
    }
  }

  return { rawTracks, resolvedPlaylists, playlistIdsByTrack, trackIdToLastPlayed };
}

export function parseRekordboxXml(context: RekordboxXmlContext): ParsedRekordbox {
  const sourceId = context.sourceId?.trim() || DEFAULT_SOURCE_ID;
  const revision = rekordboxXmlRevision(context.xml);
  const parsed = parseRawXml(context.xml, sourceId);
  const source: DjLibrarySourceIdentity = {
    sourceId,
    kind: "rekordbox",
    displayName: context.displayName?.trim() || "Rekordbox XML",
    revision,
  };

  const tracks: NormalizedDjLibraryTrack[] = parsed.rawTracks.map((raw) => {
    const metadata = metadataFromTrack(raw);
    const cuePoints = cuePointsFromTrack(raw);
    const beatGrid = beatGridFromTrack(raw);
    const provenance: DjLibraryAnalysisProvenance[] = [
      { field: "metadata", source: REKORDBOX_XML_ADAPTER_VERSION, confidence: 1, revision },
    ];
    if (metadata.bpm != null) provenance.push({ field: "bpm", source: REKORDBOX_XML_ADAPTER_VERSION, confidence: 0.95, revision });
    if (metadata.musicalKey) provenance.push({ field: "key", source: REKORDBOX_XML_ADAPTER_VERSION, confidence: 0.9, revision });
    if (beatGrid) provenance.push({ field: "grid", source: REKORDBOX_XML_ADAPTER_VERSION, confidence: beatGrid.confidence ?? 0.9, revision });
    if (cuePoints.length) provenance.push({ field: "cue", source: REKORDBOX_XML_ADAPTER_VERSION, confidence: 1, revision });
    return {
      version: DJ_LIBRARY_CONTRACT_VERSION,
      stableId: sourceStableTrackId("rekordbox", sourceId, raw.sourceTrackId),
      source: {
        version: SOURCE_CONTRACT_VERSION,
        kind: "rekordbox",
        trackId: raw.sourceTrackId,
        executionTarget: "device",
        librarySourceId: sourceId,
        recordingFingerprint: null,
        revision,
        availability: raw.attrs.Location ? "available" : "missing",
      },
      sourceTrackId: raw.sourceTrackId,
      recordingFingerprint: null,
      metadata,
      playlistIds: parsed.playlistIdsByTrack.get(raw.sourceTrackId) ?? [],
      cuePoints,
      beatGrid,
      analysisProvenance: provenance,
      canonicalTrackId: null,
      trackIntelligenceFingerprint: null,
    };
  });

  const history: DjLibraryPlayHistoryEntry[] = [];
  for (const playlist of parsed.resolvedPlaylists.filter((item) => item.kind === "history")) {
    playlist.trackIds.forEach((trackId, position) => {
      history.push({
        id: `${playlist.id}:play:${position}:${trackId}`,
        sourceId,
        trackId,
        playedAt: parsed.trackIdToLastPlayed.get(trackId) ?? null,
        context: playlist.name,
        position,
      });
    });
  }

  return {
    source,
    revision,
    tracks,
    playlists: parsed.resolvedPlaylists.map((playlist) => ({ ...playlist, revision })),
    history,
    rawTracks: parsed.rawTracks,
  };
}

export class RekordboxXmlSourceAdapter implements DjLibrarySourceAdapter<RekordboxXmlContext> {
  readonly descriptor: AutoMixSourceDescriptor = {
    kind: "rekordbox",
    displayName: "Rekordbox XML",
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

  async detect(context: RekordboxXmlContext): Promise<DjLibraryDetection> {
    try {
      const parsed = parseRekordboxXml(context);
      return { status: "available", source: parsed.source };
    } catch (error) {
      return {
        status: "unavailable",
        source: null,
        reason: error instanceof Error ? error.message : "Invalid Rekordbox XML.",
      };
    }
  }

  async describeSource(context: RekordboxXmlContext) {
    return parseRekordboxXml(context).source;
  }

  async scanTracks(context: RekordboxXmlContext) {
    return parseRekordboxXml(context).tracks;
  }

  async scanPlaylists(context: RekordboxXmlContext) {
    return parseRekordboxXml(context).playlists;
  }

  async readTrackMetadata(context: RekordboxXmlContext, trackId: string) {
    return parseRekordboxXml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.metadata ?? null;
  }

  async readCuePoints(context: RekordboxXmlContext, trackId: string) {
    return parseRekordboxXml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.cuePoints ?? [];
  }

  async readBeatGrid(context: RekordboxXmlContext, trackId: string) {
    return parseRekordboxXml(context).tracks.find((track) => track.sourceTrackId === trackId || track.stableId === trackId)?.beatGrid ?? null;
  }

  async readPlayHistory(context: RekordboxXmlContext) {
    return parseRekordboxXml(context).history;
  }

  async getRevision(context: RekordboxXmlContext) {
    return rekordboxXmlRevision(context.xml);
  }
}

function requireLocalFileUri(value: string | null | undefined, title: string) {
  const uri = value?.trim() || "";
  if (!/^file:\/\//i.test(uri)) {
    throw new Error(`Rekordbox export requires an explicit local file:// URI for ${title}.`);
  }
  return uri;
}

function exportTrackAttributes(track: NormalizedDjLibraryTrack, exportId: number, location: string) {
  const metadata = track.metadata;
  const attrs: Array<[string, string | number | null | undefined]> = [
    ["TrackID", exportId],
    ["Name", metadata.title],
    ["Artist", metadata.artist],
    ["Album", metadata.album],
    ["Genre", metadata.genre],
    ["TotalTime", metadata.durationMs == null ? null : Math.round(metadata.durationMs / 1000)],
    ["AverageBpm", metadata.bpm],
    ["Comments", metadata.comments],
    ["Rating", metadata.rating == null ? null : clamp(Math.round(metadata.rating), 0, 5) * 51],
    ["Location", location],
    ["Tonality", metadata.musicalKey],
    ["Colour", metadata.color],
    ["Year", metadata.year],
  ];
  return attrs.filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${encodeXml(value)}"`).join(" ");
}

function exportTempo(track: NormalizedDjLibraryTrack) {
  if (!track.beatGrid) return [];
  const grid = track.beatGrid;
  return [`      <TEMPO Inizio="${(grid.firstBeatMs / 1000).toFixed(3)}" Bpm="${grid.bpm.toFixed(2)}" Metro="${grid.beatsPerBar}/4" Battito="1"/>`];
}

function exportMarks(track: NormalizedDjLibraryTrack) {
  let hotCue = 0;
  return track.cuePoints.flatMap((cue) => {
    if (!["cue", "memory", "hot_cue", "loop"].includes(cue.kind)) return [];
    const type = cue.kind === "loop" ? 4 : 0;
    const num = cue.kind === "hot_cue" ? hotCue++ : -1;
    const attrs = [
      `Name="${encodeXml(cue.name ?? "")}"`,
      `Type="${type}"`,
      `Start="${(cue.positionMs / 1000).toFixed(3)}"`,
      `Num="${num}"`,
    ];
    if (cue.kind === "loop" && cue.endPositionMs != null) attrs.push(`End="${(cue.endPositionMs / 1000).toFixed(3)}"`);
    return [`      <POSITION_MARK ${attrs.join(" ")}/>`];
  });
}

function renderPlaylistNode(
  playlist: DjLibraryPlaylist,
  childrenByParent: Map<string | null, DjLibraryPlaylist[]>,
  exportIds: Map<string, number>,
  seen: Set<string>,
  indent: string,
): string[] {
  if (seen.has(playlist.id)) throw new Error("Rekordbox export cannot serialize cyclic playlist hierarchy.");
  seen.add(playlist.id);
  const children = childrenByParent.get(playlist.id) ?? [];
  const isFolder = playlist.kind === "folder";
  if (isFolder) {
    const lines = [`${indent}<NODE Type="0" Name="${encodeXml(playlist.name)}" Count="${children.length}">`];
    for (const child of children) lines.push(...renderPlaylistNode(child, childrenByParent, exportIds, seen, `${indent}  `));
    lines.push(`${indent}</NODE>`);
    seen.delete(playlist.id);
    return lines;
  }
  const trackIds = playlist.trackIds.flatMap((trackId) => exportIds.has(trackId) ? [exportIds.get(trackId)!] : []);
  const lines = [`${indent}<NODE Type="1" Name="${encodeXml(playlist.name)}" Entries="${trackIds.length}" KeyType="0">`];
  for (const id of trackIds) lines.push(`${indent}  <TRACK Key="${id}"/>`);
  lines.push(`${indent}</NODE>`);
  seen.delete(playlist.id);
  return lines;
}

export function exportRekordboxXml(input: RekordboxXmlExportInput) {
  const tracks = [...input.tracks];
  const stableIds = new Set<string>();
  for (const track of tracks) {
    if (stableIds.has(track.stableId)) throw new Error(`Duplicate normalized track identity: ${track.stableId}`);
    stableIds.add(track.stableId);
  }
  const exportIds = new Map(tracks.map((track, index) => [track.sourceTrackId, index + 1]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    `  <PRODUCT Name="${encodeXml(input.productName ?? "Ensemblis")}" Version="${encodeXml(input.productVersion ?? "1")}" Company="Ensemblis"/>`,
    `  <COLLECTION Entries="${tracks.length}">`,
  ];

  for (const [index, track] of tracks.entries()) {
    const location = requireLocalFileUri(input.locationForTrack(track), track.metadata.title);
    lines.push(`    <TRACK ${exportTrackAttributes(track, index + 1, location)}>`);
    lines.push(...exportTempo(track), ...exportMarks(track));
    lines.push("    </TRACK>");
  }
  lines.push("  </COLLECTION>", "  <PLAYLISTS>");

  const childrenByParent = new Map<string | null, DjLibraryPlaylist[]>();
  const playlistIds = new Set(input.playlists.map((playlist) => playlist.id));
  for (const playlist of input.playlists) {
    const parentId = playlist.parentId && playlistIds.has(playlist.parentId) ? playlist.parentId : null;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(playlist);
    childrenByParent.set(parentId, children);
  }
  const roots = childrenByParent.get(null) ?? [];
  lines.push(`    <NODE Type="0" Name="ROOT" Count="${roots.length}">`);
  const seen = new Set<string>();
  for (const playlist of roots) lines.push(...renderPlaylistNode(playlist, childrenByParent, exportIds, seen, "      "));
  lines.push("    </NODE>", "  </PLAYLISTS>", "</DJ_PLAYLISTS>", "");
  return lines.join("\n");
}