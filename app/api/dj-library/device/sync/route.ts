import { NextResponse } from "next/server";
import {
  DEVICE_SYNC_VERSION,
  SOURCE_KINDS,
  DeviceRequestError,
  assertPathFree,
  authenticateLibraryDevice,
  boundedNumber,
  boundedString,
  jsonByteLength,
  record,
  requireBodyWithin,
} from "@/lib/dj-library/device-server";
import type { DjLibrarySourceKind } from "@/types/dj-library-bridge-database";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FINGERPRINT_RE = /^sha256:[0-9a-f]{64}$/;
const AVAILABILITY = new Set(["available", "missing", "offline", "unknown"]);
const MAX_TRACKS_PER_CHUNK = 250;
const MAX_REMOVALS_PER_CHUNK = 5000;
const PLANNING_EVIDENCE_VERSION = "ensemblis.dj-library-planning-evidence.v1";

function optionalText(value: unknown, max: number, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return boundedString(value, max, field);
}

function safeStringArray(value: unknown, maxItems: number, maxLength: number, field: string) {
  if (!Array.isArray(value)) return [];
  if (value.length > maxItems) throw new DeviceRequestError(`${field} has too many entries.`);
  return value.map((item, index) => boundedString(item, maxLength, `${field}[${index}]`, { required: true }));
}

function safeJson(value: unknown, maxBytes: number, field: string, fallback: Json): Json {
  const candidate = value === undefined ? fallback : value;
  assertPathFree(candidate, field);
  if (jsonByteLength(candidate) > maxBytes) {
    throw new DeviceRequestError(`${field} is too large.`);
  }
  return candidate as Json;
}

function sanitizeMetadata(value: unknown) {
  const source = record(value);
  const title = boundedString(source.title, 500, "metadata.title", { required: true });
  return {
    title,
    artist: optionalText(source.artist, 500, "metadata.artist"),
    album: optionalText(source.album, 500, "metadata.album"),
    remix: optionalText(source.remix, 500, "metadata.remix"),
    genre: optionalText(source.genre, 200, "metadata.genre"),
    comments: optionalText(source.comments, 2000, "metadata.comments"),
    durationMs: boundedNumber(source.durationMs, 0, 24 * 60 * 60 * 1000, "metadata.durationMs"),
    bpm: boundedNumber(source.bpm, 20, 400, "metadata.bpm"),
    musicalKey: optionalText(source.musicalKey, 32, "metadata.musicalKey"),
    rating: boundedNumber(source.rating, 0, 5, "metadata.rating"),
    color: optionalText(source.color, 64, "metadata.color"),
    tags: safeStringArray(source.tags, 64, 100, "metadata.tags"),
    year: boundedNumber(source.year, 1000, 3000, "metadata.year"),
  };
}

function sanitizePlanningEvidence(value: unknown) {
  if (value === null || value === undefined) return null;
  const evidence = record(value);
  if (evidence.version !== PLANNING_EVIDENCE_VERSION) {
    throw new DeviceRequestError("planningEvidence uses an unsupported contract version.");
  }
  const safe = safeJson(evidence, 64 * 1024, "planningEvidence", null);
  const descriptor = record(evidence.descriptor);
  const durationMs = boundedNumber(descriptor.durationMs, 1, 24 * 60 * 60 * 1000, "planningEvidence.descriptor.durationMs");
  const bpm = boundedNumber(descriptor.bpm, 20, 400, "planningEvidence.descriptor.bpm");
  const key = record(descriptor.key);
  if (!durationMs || !bpm || !boundedString(key.camelot, 8, "planningEvidence.descriptor.key.camelot", { required: true })) {
    throw new DeviceRequestError("planningEvidence is missing required planner descriptor evidence.");
  }
  return safe;
}

function sanitizeTrack(value: unknown) {
  const source = record(value);
  const sourceTrackId = boundedString(source.sourceTrackId, 512, "sourceTrackId", { required: true });
  const recordingFingerprint = boundedString(source.recordingFingerprint, 80, "recordingFingerprint", { required: true });
  if (!FINGERPRINT_RE.test(recordingFingerprint)) {
    throw new DeviceRequestError("recordingFingerprint must be a content SHA-256 identity.");
  }
  const availability = boundedString(source.availability, 16, "availability") || "unknown";
  if (!AVAILABILITY.has(availability)) throw new DeviceRequestError("availability is invalid.");

  const track = {
    sourceTrackId,
    recordingFingerprint,
    metadata: sanitizeMetadata(source.metadata),
    playlistIds: safeStringArray(source.playlistIds, 512, 200, "playlistIds"),
    cuePoints: safeJson(source.cuePoints, 96 * 1024, "cuePoints", []),
    beatGrid: source.beatGrid === null
      ? null
      : safeJson(source.beatGrid, 96 * 1024, "beatGrid", null),
    analysisProvenance: safeJson(source.analysisProvenance, 48 * 1024, "analysisProvenance", []),
    planningEvidence: sanitizePlanningEvidence(source.planningEvidence),
    availability,
  };
  assertPathFree(track, "track");
  if (jsonByteLength(track) > 256 * 1024) {
    throw new DeviceRequestError("A synchronized track record is too large.");
  }
  return track;
}

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not synchronize Library Bridge state." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    requireBodyWithin(request, 2 * 1024 * 1024);
    const { client, device } = await authenticateLibraryDevice(request);
    const body = record(await request.json().catch(() => null));
    if (body.version !== DEVICE_SYNC_VERSION) {
      throw new DeviceRequestError("Unsupported Library Bridge sync contract.");
    }

    const delta = record(body.delta);
    const sourceId = boundedString(delta.sourceId, 200, "sourceId", { required: true });
    const sourceKindValue = boundedString(delta.sourceKind, 32, "sourceKind", { required: true });
    if (!SOURCE_KINDS.has(sourceKindValue as DjLibrarySourceKind)) {
      throw new DeviceRequestError("sourceKind is invalid.");
    }
    const sourceKind = sourceKindValue as DjLibrarySourceKind;
    const baseRevision = optionalText(delta.baseRevision, 200, "baseRevision");
    const targetRevision = boundedString(delta.targetRevision, 200, "targetRevision", { required: true });

    const changedRaw = Array.isArray(delta.changedTracks) ? delta.changedTracks : [];
    const removedRaw = Array.isArray(delta.removedSourceTrackIds) ? delta.removedSourceTrackIds : [];
    if (changedRaw.length > MAX_TRACKS_PER_CHUNK) {
      throw new DeviceRequestError(`A sync chunk may contain at most ${MAX_TRACKS_PER_CHUNK} changed tracks.`);
    }
    if (removedRaw.length > MAX_REMOVALS_PER_CHUNK) {
      throw new DeviceRequestError(`A sync chunk may contain at most ${MAX_REMOVALS_PER_CHUNK} removals.`);
    }
    const changedTracks = changedRaw.map(sanitizeTrack);
    const removedSourceTrackIds = safeStringArray(removedRaw, MAX_REMOVALS_PER_CHUNK, 512, "removedSourceTrackIds");

    const batch = record(body.batch);
    const batchIndex = Number.isInteger(batch.index) ? Number(batch.index) : 0;
    const batchCount = Number.isInteger(batch.count) ? Number(batch.count) : 1;
    if (batchIndex < 0 || batchCount < 1 || batchCount > 1000 || batchIndex >= batchCount) {
      throw new DeviceRequestError("Sync batch coordinates are invalid.");
    }

    const { data: currentSource, error: currentError } = await client
      .from("dj_library_device_sources")
      .select("id,revision,track_count")
      .eq("device_id", device.id)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (currentSource?.revision === targetRevision) {
      return NextResponse.json({ accepted: true, complete: true, revision: targetRevision, trackCount: currentSource.track_count });
    }
    if ((currentSource?.revision ?? null) !== baseRevision) {
      return NextResponse.json({
        error: "Library source revision conflict. Rescan from the cloud-acknowledged baseline.",
        currentRevision: currentSource?.revision ?? null,
      }, { status: 409 });
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await client.from("dj_library_sync_chunks").delete().eq("device_id", device.id).lt("created_at", cutoff);
    await client
      .from("dj_library_sync_chunks")
      .delete()
      .eq("device_id", device.id)
      .eq("source_id", sourceId)
      .neq("target_revision", targetRevision);

    const payload = { changedTracks, removedSourceTrackIds };
    assertPathFree(payload, "sync payload");
    const { error: stageError } = await client.from("dj_library_sync_chunks").upsert({
      device_id: device.id,
      owner_id: device.owner_id,
      artist_id: device.artist_id,
      source_id: sourceId,
      source_kind: sourceKind,
      base_revision: baseRevision,
      target_revision: targetRevision,
      batch_index: batchIndex,
      batch_count: batchCount,
      payload,
    }, { onConflict: "device_id,source_id,target_revision,batch_index" });
    if (stageError) throw stageError;

    const { count, error: countError } = await client
      .from("dj_library_sync_chunks")
      .select("id", { head: true, count: "exact" })
      .eq("device_id", device.id)
      .eq("source_id", sourceId)
      .eq("target_revision", targetRevision)
      .eq("batch_count", batchCount);
    if (countError) throw countError;
    if ((count ?? 0) < batchCount) {
      return NextResponse.json({ accepted: true, complete: false, revision: targetRevision, receivedChunks: count ?? 0, batchCount });
    }

    const { data: applied, error: applyError } = await client.rpc("apply_dj_library_sync_revision", {
      p_device_id: device.id,
      p_source_id: sourceId,
      p_source_kind: sourceKind,
      p_base_revision: baseRevision,
      p_target_revision: targetRevision,
      p_batch_count: batchCount,
    });
    if (applyError || !applied?.[0]) {
      if (applyError?.message?.includes("source_revision_conflict")) {
        return NextResponse.json({ error: "Library source revision conflict." }, { status: 409 });
      }
      if (applyError?.message?.includes("sync_revision_incomplete")) {
        return NextResponse.json({ error: "Library sync revision is incomplete." }, { status: 409 });
      }
      throw applyError ?? new Error("sync revision did not apply");
    }

    return NextResponse.json({
      accepted: true,
      complete: true,
      revision: applied[0].revision,
      trackCount: applied[0].track_count,
    });
  } catch (error) {
    return failure(error);
  }
}
