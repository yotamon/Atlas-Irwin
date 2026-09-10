import "server-only";

import {
  AUTOMIX_CANDIDATE_SNAPSHOT_VERSION,
  PLANNING_EVIDENCE_VERSION,
  deviceCandidateId,
  planningReadiness,
  type DeviceCandidateSnapshotItem,
} from "@/lib/automix/source-candidates";
import { AUTOMIX_SOURCE_REF_VERSION, type AutoMixSourceKind } from "@/lib/automix/source-contract";
import { createDjLibraryServiceClient, record } from "@/lib/dj-library/device-server";

export const AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION = "ensemblis.automix-hybrid-candidates.v1" as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/i;
const DEVICE_SOURCE_KINDS = new Set<AutoMixSourceKind>(["local_library", "rekordbox", "traktor"]);

export type HybridCandidateSnapshot = {
  version: typeof AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION;
  executionTarget: "hybrid_device";
  catalogTrackIds: string[];
  deviceId: string;
  deviceCandidates: DeviceCandidateSnapshotItem[];
  candidateOrder: string[];
};

type RequestedRef =
  | { kind: "catalog"; trackId: string }
  | { kind: "dj_library"; libraryTrackId: string };

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function parseRequested(value: unknown): RequestedRef[] {
  if (!Array.isArray(value)) return [];
  const result: RequestedRef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = record(raw);
    if (item.kind === "catalog") {
      const trackId = typeof item.trackId === "string" ? item.trackId.trim() : "";
      const key = `catalog:${trackId}`;
      if (!UUID_RE.test(trackId) || seen.has(key)) continue;
      seen.add(key);
      result.push({ kind: "catalog", trackId });
    } else if (item.kind === "dj_library") {
      const libraryTrackId = typeof item.libraryTrackId === "string" ? item.libraryTrackId.trim() : "";
      const key = `device:${libraryTrackId}`;
      if (!UUID_RE.test(libraryTrackId) || seen.has(key)) continue;
      seen.add(key);
      result.push({ kind: "dj_library", libraryTrackId });
    }
  }
  return result;
}

export function hybridCandidateIds(snapshot: HybridCandidateSnapshot) {
  return [...snapshot.candidateOrder];
}

export function hybridDeviceSnapshot(snapshot: HybridCandidateSnapshot) {
  return {
    version: AUTOMIX_CANDIDATE_SNAPSHOT_VERSION,
    executionTarget: "device" as const,
    candidates: snapshot.deviceCandidates,
  };
}

export function normalizeHybridCandidateSnapshot(value: unknown): HybridCandidateSnapshot | null {
  const raw = record(value);
  if (raw.version !== AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION || raw.executionTarget !== "hybrid_device") return null;
  const catalogTrackIds = array(raw.catalogTrackIds).filter((id): id is string => typeof id === "string" && UUID_RE.test(id));
  const deviceId = typeof raw.deviceId === "string" && UUID_RE.test(raw.deviceId) ? raw.deviceId : "";
  const candidatesRaw = array(raw.deviceCandidates);
  const candidateOrder = array(raw.candidateOrder).filter((id): id is string => typeof id === "string" && Boolean(id));
  if (!deviceId || !catalogTrackIds.length || !candidatesRaw.length) return null;
  if (catalogTrackIds.length + candidatesRaw.length < 2 || catalogTrackIds.length + candidatesRaw.length > 20) return null;
  if (new Set(catalogTrackIds).size !== catalogTrackIds.length || new Set(candidateOrder).size !== candidateOrder.length) return null;

  const deviceCandidates: DeviceCandidateSnapshotItem[] = [];
  for (const rawCandidate of candidatesRaw) {
    const candidate = record(rawCandidate);
    const source = record(candidate.source);
    const libraryTrackId = typeof candidate.libraryTrackId === "string" ? candidate.libraryTrackId : "";
    const candidateId = typeof candidate.candidateId === "string" ? candidate.candidateId : "";
    const sourceKind = typeof source.kind === "string" ? source.kind as AutoMixSourceKind : "local_library";
    const fingerprint = typeof source.recordingFingerprint === "string" ? source.recordingFingerprint : "";
    const revision = typeof source.revision === "string" ? source.revision : "";
    if (
      !UUID_RE.test(libraryTrackId)
      || candidateId !== deviceCandidateId(libraryTrackId)
      || candidate.deviceId !== deviceId
      || source.version !== AUTOMIX_SOURCE_REF_VERSION
      || source.executionTarget !== "device"
      || !DEVICE_SOURCE_KINDS.has(sourceKind)
      || typeof source.trackId !== "string"
      || !source.trackId
      || !FINGERPRINT_RE.test(fingerprint)
      || !revision
      || source.availability !== "available"
    ) return null;
    const planningEvidence = record(candidate.planningEvidence);
    if (planningEvidence.version !== PLANNING_EVIDENCE_VERSION) return null;
    const readiness = planningReadiness({
      recordingFingerprint: fingerprint,
      planningEvidence,
      availability: "available",
      revision,
    }, sourceKind);
    if (!readiness.ready) return null;
    deviceCandidates.push({
      candidateId,
      libraryTrackId,
      deviceId,
      source: {
        version: AUTOMIX_SOURCE_REF_VERSION,
        kind: sourceKind,
        trackId: source.trackId,
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
  const expected = new Set([...catalogTrackIds, ...deviceCandidates.map((candidate) => candidate.candidateId)]);
  if (candidateOrder.length !== expected.size || candidateOrder.some((id) => !expected.has(id))) return null;
  return {
    version: AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION,
    executionTarget: "hybrid_device",
    catalogTrackIds,
    deviceId,
    deviceCandidates,
    candidateOrder,
  };
}

export async function resolveHybridCandidateSnapshot({
  ownerId,
  artistId,
  requested,
}: {
  ownerId: string;
  artistId: string;
  requested: unknown;
}): Promise<HybridCandidateSnapshot> {
  const refs = parseRequested(requested);
  if (refs.length < 2 || refs.length > 20) throw new Error("Choose 2-20 unique catalog and Library Bridge tracks.");
  const catalogTrackIds = refs.flatMap((ref) => ref.kind === "catalog" ? [ref.trackId] : []);
  const libraryTrackIds = refs.flatMap((ref) => ref.kind === "dj_library" ? [ref.libraryTrackId] : []);
  if (!catalogTrackIds.length || !libraryTrackIds.length) {
    throw new Error("A hybrid set requires at least one catalog track and one Library Bridge track.");
  }

  const client = createDjLibraryServiceClient();
  const { data: tracks, error: trackError } = await client
    .from("dj_library_source_tracks")
    .select("id,device_id,device_source_id,source_id,source_track_id,recording_fingerprint,metadata,playlist_ids,cue_points,beat_grid,analysis_provenance,planning_evidence,availability,revision")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .in("id", libraryTrackIds);
  if (trackError) throw new Error("Could not validate hybrid Library Bridge candidates.");
  const rows = (tracks ?? []) as Array<Record<string, unknown>>;
  if (rows.length !== libraryTrackIds.length) throw new Error("A selected Library Bridge track is unavailable.");

  const deviceIds = [...new Set(rows.map((row) => String(row.device_id ?? "")).filter(Boolean))];
  if (deviceIds.length !== 1 || !UUID_RE.test(deviceIds[0])) {
    throw new Error("Hybrid sets must use Library Bridge tracks available on one paired computer.");
  }
  const deviceId = deviceIds[0];
  const sourceRowIds = [...new Set(rows.map((row) => String(row.device_source_id ?? "")).filter(Boolean))];
  const [{ data: devices, error: deviceError }, { data: sources, error: sourceError }] = await Promise.all([
    client.from("dj_library_devices")
      .select("id")
      .eq("id", deviceId)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .is("revoked_at", null),
    client.from("dj_library_device_sources")
      .select("id,device_id,source_id,source_kind,revision")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("id", sourceRowIds),
  ]);
  if (deviceError || sourceError || !devices?.length) throw new Error("The paired computer for this hybrid set is unavailable.");
  const sourceById = new Map(((sources ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
  const rowById = new Map(rows.map((row) => [String(row.id), row]));

  const deviceCandidates: DeviceCandidateSnapshotItem[] = [];
  for (const libraryTrackId of libraryTrackIds) {
    const row = rowById.get(libraryTrackId);
    const source = row ? sourceById.get(String(row.device_source_id ?? "")) : null;
    if (!row || !source || row.device_id !== deviceId || source.device_id !== deviceId) {
      throw new Error("A selected Library Bridge track is no longer available on the paired computer.");
    }
    const sourceKind = String(source.source_kind ?? "") as AutoMixSourceKind;
    if (!DEVICE_SOURCE_KINDS.has(sourceKind)) throw new Error("Unsupported Library Bridge source kind in hybrid set.");
    const readiness = planningReadiness(row, sourceKind);
    if (!readiness.ready) throw new Error(`Hybrid Library Bridge track is not planning-ready: ${readiness.reasons.join(", ")}.`);
    const fingerprint = String(row.recording_fingerprint ?? "");
    const revision = String(row.revision ?? "");
    deviceCandidates.push({
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

  const candidateOrder = refs.map((ref) => ref.kind === "catalog" ? ref.trackId : deviceCandidateId(ref.libraryTrackId));
  const snapshot: HybridCandidateSnapshot = {
    version: AUTOMIX_HYBRID_CANDIDATE_SNAPSHOT_VERSION,
    executionTarget: "hybrid_device",
    catalogTrackIds,
    deviceId,
    deviceCandidates,
    candidateOrder,
  };
  if (!normalizeHybridCandidateSnapshot(snapshot)) throw new Error("Hybrid candidate snapshot failed contract validation.");
  return snapshot;
}

export async function assertHybridDeviceSourcesStillAvailable({
  ownerId,
  artistId,
  snapshot,
}: {
  ownerId: string;
  artistId: string;
  snapshot: HybridCandidateSnapshot;
}) {
  const client = createDjLibraryServiceClient();
  const ids = snapshot.deviceCandidates.map((candidate) => candidate.libraryTrackId);
  const [{ data: device, error: deviceError }, { data: tracks, error: trackError }] = await Promise.all([
    client.from("dj_library_devices")
      .select("id")
      .eq("id", snapshot.deviceId)
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .is("revoked_at", null)
      .maybeSingle(),
    client.from("dj_library_source_tracks")
      .select("id,device_id,source_id,source_track_id,recording_fingerprint,availability,revision")
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .in("id", ids),
  ]);
  if (deviceError || trackError || !device) throw new Error("The paired computer for this hybrid set is unavailable.");
  const byId = new Map(((tracks ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
  for (const candidate of snapshot.deviceCandidates) {
    const row = byId.get(candidate.libraryTrackId);
    if (
      !row
      || row.device_id !== snapshot.deviceId
      || row.source_id !== candidate.source.librarySourceId
      || row.source_track_id !== candidate.source.trackId
      || row.recording_fingerprint !== candidate.source.recordingFingerprint
      || row.revision !== candidate.source.revision
      || row.availability !== "available"
    ) throw new Error("A local recording changed or became unavailable after this hybrid Set Plan was frozen.");
  }
  return snapshot.deviceId;
}
