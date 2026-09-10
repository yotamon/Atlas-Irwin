import { NextResponse } from "next/server";
import { planningReadiness } from "@/lib/automix/source-candidates";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { DeviceRequestError, createDjLibraryServiceClient } from "@/lib/dj-library/device-server";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;

function safeInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

async function scope(artistId: string) {
  if (!UUID_RE.test(artistId)) throw new DeviceRequestError("A valid artistId is required.");
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  return { ownerId: user.id, artistId: artist.artistId };
}

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not read Library Bridge tracks." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const artistId = url.searchParams.get("artistId")?.trim() ?? "";
    const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
    const sourceId = url.searchParams.get("sourceId")?.trim() ?? "";
    const limit = safeInt(url.searchParams.get("limit"), 100, 1, MAX_PAGE_SIZE);
    const offset = safeInt(url.searchParams.get("offset"), 0, 0, 100_000);
    if (deviceId && !UUID_RE.test(deviceId)) throw new DeviceRequestError("deviceId is invalid.");
    if (sourceId.length > 200) throw new DeviceRequestError("sourceId is too long.");

    const auth = await scope(artistId);
    const client = createDjLibraryServiceClient();
    let sourceQuery = client
      .from("dj_library_device_sources")
      .select("id,device_id,source_id,source_kind,revision,last_synced_at")
      .eq("owner_id", auth.ownerId)
      .eq("artist_id", auth.artistId);
    if (deviceId) sourceQuery = sourceQuery.eq("device_id", deviceId);
    if (sourceId) sourceQuery = sourceQuery.eq("source_id", sourceId);
    const { data: sources, error: sourcesError } = await sourceQuery;
    if (sourcesError) throw sourcesError;

    const sourceRows = (sources ?? []) as Array<Record<string, unknown>>;
    const allowedSourceIds = sourceRows
      .map((row) => typeof row.id === "string" ? row.id : "")
      .filter(Boolean);
    if (!allowedSourceIds.length) {
      return NextResponse.json({ tracks: [], total: 0, limit, offset, planningReadyCount: 0 });
    }
    const sourceById = new Map(sourceRows.map((row) => [String(row.id), row]));

    const { data: tracks, error: tracksError, count } = await client
      .from("dj_library_source_tracks")
      .select(
        "id,device_id,device_source_id,source_id,source_track_id,recording_fingerprint,metadata,playlist_ids,cue_points,beat_grid,analysis_provenance,planning_evidence,availability,revision,updated_at",
        { count: "exact" },
      )
      .eq("owner_id", auth.ownerId)
      .eq("artist_id", auth.artistId)
      .in("device_source_id", allowedSourceIds)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (tracksError) throw tracksError;

    const safeTracks = ((tracks ?? []) as Array<Record<string, unknown>>).map((row) => {
      const source = sourceById.get(String(row.device_source_id)) ?? {};
      const sourceKind = typeof source.source_kind === "string" ? source.source_kind : "local_library";
      const readiness = planningReadiness(row, sourceKind);
      return {
        id: row.id,
        deviceId: row.device_id,
        sourceId: row.source_id,
        sourceKind,
        sourceTrackId: row.source_track_id,
        recordingFingerprint: row.recording_fingerprint,
        metadata: row.metadata,
        playlistIds: row.playlist_ids,
        cuePoints: row.cue_points,
        beatGrid: row.beat_grid,
        analysisProvenance: row.analysis_provenance,
        planningEvidence: row.planning_evidence,
        availability: row.availability,
        revision: row.revision,
        lastSyncedAt: source.last_synced_at ?? null,
        planningReady: readiness.ready,
        planningReadiness: readiness,
      };
    });

    return NextResponse.json({
      tracks: safeTracks,
      total: count ?? safeTracks.length,
      limit,
      offset,
      planningReadyCount: safeTracks.filter((track) => track.planningReady).length,
    });
  } catch (error) {
    return failure(error);
  }
}
