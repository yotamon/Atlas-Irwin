import "server-only";

import {
  createDjLibraryServiceClient,
  record,
} from "@/lib/dj-library/device-server";
import {
  AUTOMIX_SOURCE_REF_VERSION,
  type AutoMixSourceKind,
  type AutoMixSourceTrackRef,
} from "@/lib/automix/source-contract";

export const AUTOMIX_CANDIDATE_SNAPSHOT_VERSION = "ensemblis.automix-candidates.v1" as const;
export const PLANNING_EVIDENCE_VERSION = "ensemblis.dj-library-planning-evidence.v1" as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/i;
const DEVICE_SOURCE_KINDS = new Set<AutoMixSourceKind>(["local_library", "rekordbox", "serato", "traktor"]);

export type PlanningReadiness = {
  ready: boolean;
  reasons: string[];
  evidence: {
    duration: boolean;
    bpm: boolean;
    key: boolean;
    musicMap: boolean;
    fingerprint: boolean;
    sourceKind: string;
  };
};

export type DeviceCandidateSnapshotItem = {
  candidateId: string;
  libraryTrackId: string;
  deviceId: string;
  source: AutoMixSourceTrackRef;
  metadata: Record<string, unknown>;
  playlistIds: unknown[];
  cuePoints: unknown[];
  beatGrid: Record<string, unknown> | null;
  analysisProvenance: unknown[];
  planningEvidence: Record<string, unknown>;
};

export type DeviceCandidateSnapshot = {
  version: typeof AUTOMIX_CANDIDATE_SNAPSHOT_VERSION;
  executionTarget: "device";
  candidates: DeviceCandidateSnapshotItem[];
};

function finitePositive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteUnit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function deviceCandidateId(libraryTrackId: string) {
  return `dj-library:${libraryTrackId}`;
}

export function planningReadiness(
  row: Record<string, unknown>,
  sourceKind: string,
): PlanningReadiness {
  const evidence = record(row.planning_evidence ?? row.planningEvidence);
  const descriptor = record(evidence.descriptor);
  const key = record(descriptor.key);
  const musicMap = record(evidence.musicMap ?? evidence.music_map);
  const fingerprint = typeof row.recording_fingerprint === "string"
    ? row.recording_fingerprint
    : typeof row.recordingFingerprint === "string"
      ? row.recordingFingerprint
      : "";
  const durationReady = finitePositive(descriptor.durationMs)
    && finitePositive(musicMap.duration_ms);
  const bpmReady = finitePositive(descriptor.bpm) && finitePositive(descriptor.djBpm);
  const rootPc = key.rootPc;
  const keyReady = typeof rootPc === "number"
    && Number.isInteger(rootPc)
    && rootPc >= 0
    && rootPc <= 11
    && (key.mode === "major" || key.mode === "minor")
    && typeof key.camelot === "string"
    && key.camelot.trim().length > 0
    && finiteUnit(key.confidence);
  const fingerprintReady = FINGERPRINT_RE.test(fingerprint)
    && evidence.recordingFingerprint === fingerprint;
  const versionReady = evidence.version === PLANNING_EVIDENCE_VERSION;
  const musicMapReady = Object.keys(musicMap).length > 0;
  const revision = typeof row.revision === "string" ? row.revision : "";
  const reasons = [
    row.availability !== "available" ? "source_offline" : null,
    !revision ? "source_revision_missing" : null,
    !fingerprintReady ? "recording_identity_missing" : null,
    !versionReady ? "planning_evidence_missing" : null,
    !durationReady ? "duration_missing" : null,
    !bpmReady ? "bpm_missing" : null,
    !keyReady ? "key_missing" : null,
    !musicMapReady ? "music_map_missing" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    ready: reasons.length === 0,
    reasons,
    evidence: {
      duration: durationReady,
      bpm: bpmReady,
      key: keyReady,
      musicMap: musicMapReady,
      fingerprint: fingerprintReady,
      sourceKind,
    },
  };
}

function normalizeRequestedLibraryTrackIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const raw of value) {
    const item = record(raw);
    if (item.kind !== "dj_library") continue;
    const id = typeof item.libraryTrackId === "string" ? item.libraryTrackId.trim() : "";
    if (!UUID_RE.test(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

export function requestedDeviceLibraryTrackIds(value: unknown) {
  return normalizeRequestedLibraryTrackIds(value);
}

export function normalizeDeviceCandidateSnapshot(value: unknown): DeviceCandidateSnapshot | null {
  const raw = record(value);
  if (raw.version !== AUTOMIX_CANDIDATE_SNAPSHOT_VERSION || raw.executionTarget !== "device") return null;
  if (!Array.isArray(raw.candidates) || raw.candidates.length < 2 || raw.candidates.length > 20) return null;
  const candidates: DeviceCandidateSnapshotItem[] = [];
  const seen = new Set<string>();
  for (const candidateValue of raw.candidates) {
    const candidate = record(candidateValue);
    const libraryTrackId = typeof candidate.libraryTrackId === "string" ? candidate.libraryTrackId : "";
    const candidateId = typeof candidate.candidateId === "string" ? candidate.candidateId : "";
    const deviceId = typeof candidate.deviceId === "string" ? candidate.deviceId : "";
    const source = record(candidate.source);
    const kind = source.kind;
    const trackId = typeof source.trackId === "string" ? source.trackId : "";
    const fingerprint = typeof source.recordingFingerprint === "string" ? source.recordingFingerprint : "";
    const revision = typeof source.revision === "string" ? source.revision : "";
    const sourceKind = typeof kind === "string" ? kind as AutoMixSourceKind : "local_library";
    if (
      !UUID_RE.test(libraryTrackId)
      || candidateId !== deviceCandidateId(libraryTrackId)
      || !UUID_RE.test(deviceId)
      || seen.has(candidateId)
      || source.version !== AUTOMIX_SOURCE_REF_VERSION
      || !DEVICE_SOURCE_KINDS.has(sourceKind)
      || source.executionTarget !== "device"
      || !trackId
      || !FINGERPRINT_RE.test(fingerprint)
      || !revision
      || source.availability !== "available"
    ) return null;
    const planningEvidence = record(candidate.planningEvidence);
    const readiness = planningReadiness({
      recordingFingerprint: fingerprint,
      planningEvidence,
      availability: "available",
      revision,
    }, sourceKind);
    if (!readiness.ready) return null;
    seen.add(candidateId);
    candidates.push({
      candidateId,
      libraryTrackId,
      deviceId,
      source: {
        version: AUTOMIX_SOURCE_REF_VERSION,
        kind: sourceKind,
        trackId,
        executionTarget: "device",
        librarySourceId: typeof source.librarySourceId === "string" ? source.librarySourceId : null,
        recordingFingerprint: fingerprint,
        revision,
        availability: "available",
      },
      metadata: record(candidate.metadata),
      playlistIds: array(candidate.playlistIds),
      cuePoints: array(candidate.cuePoints),
      beatGrid: Object.keys(record(candidate.beatGrid)).length ? record(candidate.beatGrid) : null,
      analysisProvenance: array(candidate.analysisProvenance),
      planningEvidence,
    });
  }
  return { version: AUTOMIX_CANDIDATE_SNAPSHOT_VERSION, executionTarget: "device", candidates };
}

export function candidateIdsFromSnapshot(snapshot: DeviceCandidateSnapshot) {
  return snapshot.candidates.map((candidate) => candidate.candidateId);
}

export function singleDeviceId(snapshot: DeviceCandidateSnapshot) {
  const ids = [...new Set(snapshot.candidates.map((candidate) => candidate.deviceId))];
  if (ids.length !== 1) {
    throw new Error("Phase 8 local sets must use tracks available on one paired computer.");
  }
  return ids[0];
}

export function workerTracksFromSnapshot(snapshot: DeviceCandidateSnapshot) {
  return snapshot.candidates.map((candidate) => ({
    id: candidate.candidateId,
    title: typeof candidate.metadata.title === "string" && candidate.metadata.title.trim()
      ? candidate.metadata.title.trim()
      : "Untitled",
    execution_target: "device",
    source_ref: candidate.source,
    recording_fingerprint: candidate.source.recordingFingerprint,
    planning_evidence: candidate.planningEvidence,
  }));
}

export function snapshotFingerprints(snapshot: DeviceCandidateSnapshot) {
  return snapshot.candidates.map((candidate) => ({
    track_id: candidate.candidateId,
    execution_target: "device",
    device_id: candidate.deviceId,
    library_track_id: candidate.libraryTrackId,
    source_kind: candidate.source.kind,
    source_id: candidate.source.librarySourceId ?? null,
    source_track_id: candidate.source.trackId,
    recording_fingerprint: candidate.source.recordingFingerprint,
    revision: candidate.source.revision,
  }));
}

export async function assertDeviceSnapshotStillAvailable({
  ownerId,
  artistId,
  snapshot,
}: {
  ownerId: string;
  artistId: string;
  snapshot: DeviceCandidateSnapshot;
}) {
  const deviceId = singleDeviceId(snapshot);
  const client = createDjLibraryServiceClient();
  const [{ data: device, error: deviceError }, { data: tracks, error: trackError }] = await Promise.all([
    client
      .from("dj_library_devices")
      .select("id")
      .eq("id", deviceId)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .is("revoked_at", null)
      .maybeSingle(),
    client
      .from("dj_library_source_tracks")
      .select("id,device_id,source_id,source_track_id,recording_fingerprint,availability")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("id", snapshot.candidates.map((candidate) => candidate.libraryTrackId)),
  ]);
  if (deviceError || trackError || !device) {
    throw new Error("The paired computer for this local set is no longer available.");
  }
  const byId = new Map(((tracks ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
  for (const candidate of snapshot.candidates) {
    const row = byId.get(candidate.libraryTrackId);
    if (
      !row
      || row.device_id !== candidate.deviceId
      || row.source_id !== candidate.source.librarySourceId
      || row.source_track_id !== candidate.source.trackId
      || row.recording_fingerprint !== candidate.source.recordingFingerprint
      || row.availability !== "available"
    ) {
      throw new Error("A local recording changed or became unavailable after this Set Plan was frozen.");
    }
  }
  return deviceId;
}

export async function resolveDeviceCandidateSnapshot({
  ownerId,
  artistId,
  requested,
}: {
  ownerId: string;
  artistId: string;
  requested: unknown;
}): Promise<DeviceCandidateSnapshot> {
  const libraryTrackIds = normalizeRequestedLibraryTrackIds(requested);
  if (libraryTrackIds.length < 2 || libraryTrackIds.length > 20) {
    throw new Error("Choose 2-20 planning-ready Library Bridge tracks.");
  }
  const client = createDjLibraryServiceClient();
  const { data: tracks, error: trackError } = await client
    .from("dj_library_source_tracks")
    .select("id,device_id,device_source_id,source_id,source_track_id,recording_fingerprint,metadata,playlist_ids,cue_points,beat_grid,analysis_provenance,planning_evidence,availability,revision")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .in("id", libraryTrackIds);
  if (trackError) throw new Error("Could not validate Library Bridge candidates.");
  const rows = (tracks ?? []) as Array<Record<string, unknown>>;
  if (rows.length !== libraryTrackIds.length) throw new Error("A selected Library Bridge track is unavailable.");

  const deviceIds = [...new Set(rows.map((row) => String(row.device_id ?? "")).filter(Boolean))];
  const sourceRowIds = [...new Set(rows.map((row) => String(row.device_source_id ?? "")).filter(Boolean))];
  const [{ data: devices, error: deviceError }, { data: sources, error: sourceError }] = await Promise.all([
    client
      .from("dj_library_devices")
      .select("id")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("id", deviceIds)
      .is("revoked_at", null),
    client
      .from("dj_library_device_sources")
      .select("id,device_id,source_id,source_kind,revision")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("id", sourceRowIds),
  ]);
  if (deviceError || sourceError) throw new Error("Could not validate Library Bridge source state.");
  const activeDevices = new Set((devices ?? []).map((row) => String((row as { id: string }).id)));
  const sourceById = new Map(((sources ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
  const rowById = new Map(rows.map((row) => [String(row.id), row]));

  const candidates: DeviceCandidateSnapshotItem[] = [];
  for (const libraryTrackId of libraryTrackIds) {
    const row = rowById.get(libraryTrackId);
    if (!row) throw new Error("A selected Library Bridge track is unavailable.");
    const deviceId = String(row.device_id ?? "");
    const source = sourceById.get(String(row.device_source_id ?? ""));
    if (!activeDevices.has(deviceId) || !source) throw new Error("A selected Library Bridge device is no longer active.");
    const sourceKind = String(source.source_kind ?? "") as AutoMixSourceKind;
    if (!DEVICE_SOURCE_KINDS.has(sourceKind)) throw new Error("Unsupported Library Bridge source kind.");
    const readiness = planningReadiness(row, sourceKind);
    if (!readiness.ready) {
      throw new Error(`Library Bridge track is not planning-ready: ${readiness.reasons.join(", ")}.`);
    }
    const fingerprint = String(row.recording_fingerprint);
    const revision = String(row.revision);
    candidates.push({
      candidateId: deviceCandidateId(libraryTrackId),
      libraryTrackId,
      deviceId,
      source: {
        version: AUTOMIX_SOURCE_REF_VERSION,
        kind: sourceKind,
        trackId: String(row.source_track_id),
        executionTarget: "device",
        librarySourceId: String(row.source_id),
        recordingFingerprint: fingerprint,
        revision,
        availability: "available",
      },
      metadata: record(row.metadata),
      playlistIds: array(row.playlist_ids),
      cuePoints: array(row.cue_points),
      beatGrid: Object.keys(record(row.beat_grid)).length ? record(row.beat_grid) : null,
      analysisProvenance: array(row.analysis_provenance),
      planningEvidence: record(row.planning_evidence),
    });
  }
  const snapshot = { version: AUTOMIX_CANDIDATE_SNAPSHOT_VERSION, executionTarget: "device", candidates } as const;
  singleDeviceId(snapshot);
  return snapshot;
}
