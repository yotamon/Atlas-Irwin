import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  DeviceRequestError,
  assertPathFree,
  boundedString,
  createDjLibraryServiceClient,
  record,
  sha256Hex,
} from "@/lib/dj-library/device-server";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function scopeFor(artistId: string) {
  if (!UUID_RE.test(artistId)) throw new DeviceRequestError("A valid artistId is required.");
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  return { ownerId: user.id, artistId: artist.artistId };
}

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not manage Library Bridge device jobs." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const artistId = url.searchParams.get("artistId")?.trim() ?? "";
    const deviceId = url.searchParams.get("deviceId")?.trim() ?? "";
    const scope = await scopeFor(artistId);
    const client = createDjLibraryServiceClient();
    let query = client
      .from("dj_library_device_jobs")
      .select("id,device_id,idempotency_key,job_type,source_revision,payload,status,result,error,claimed_at,completed_at,created_at,updated_at")
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (deviceId) {
      if (!UUID_RE.test(deviceId)) throw new DeviceRequestError("deviceId is invalid.");
      query = query.eq("device_id", deviceId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ jobs: data ?? [] });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const artistId = boundedString(body.artistId, 64, "artistId", { required: true });
    const deviceId = boundedString(body.deviceId, 64, "deviceId", { required: true });
    const sourceId = boundedString(body.sourceId, 200, "sourceId", { required: true });
    const sourceTrackId = boundedString(body.sourceTrackId, 512, "sourceTrackId", { required: true });
    if (!UUID_RE.test(deviceId)) throw new DeviceRequestError("deviceId is invalid.");
    const scope = await scopeFor(artistId);
    const client = createDjLibraryServiceClient();

    const { data: device, error: deviceError } = await client
      .from("dj_library_devices")
      .select("id")
      .eq("id", deviceId)
      .eq("owner_id", scope.ownerId)
      .eq("artist_id", scope.artistId)
      .is("revoked_at", null)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) return NextResponse.json({ error: "Library Bridge device is not active." }, { status: 404 });

    const { data: source, error: sourceError } = await client
      .from("dj_library_device_sources")
      .select("revision")
      .eq("device_id", deviceId)
      .eq("source_id", sourceId)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source?.revision) return NextResponse.json({ error: "Library source has not completed a sync revision." }, { status: 409 });

    const { data: track, error: trackError } = await client
      .from("dj_library_source_tracks")
      .select("recording_fingerprint,availability")
      .eq("device_id", deviceId)
      .eq("source_id", sourceId)
      .eq("source_track_id", sourceTrackId)
      .maybeSingle();
    if (trackError) throw trackError;
    if (!track) return NextResponse.json({ error: "Library source track was not found." }, { status: 404 });

    const payload = {
      sourceId,
      sourceTrackId,
      recordingFingerprint: track.recording_fingerprint,
    };
    assertPathFree(payload, "device job payload");
    const idempotencyKey = `resolve:${sha256Hex(`${deviceId}\n${sourceId}\n${sourceTrackId}\n${track.recording_fingerprint}`)}`;

    const { data: existing, error: existingError } = await client
      .from("dj_library_device_jobs")
      .select("id,status,result,error,created_at,updated_at")
      .eq("device_id", deviceId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ job: existing, idempotent: true });

    const { data: job, error: insertError } = await client
      .from("dj_library_device_jobs")
      .insert({
        device_id: deviceId,
        owner_id: scope.ownerId,
        artist_id: scope.artistId,
        idempotency_key: idempotencyKey,
        job_type: "resolve_media",
        source_revision: source.revision,
        payload,
        status: "queued",
      })
      .select("id,status,result,error,created_at,updated_at")
      .single();
    if (insertError) {
      // The deterministic unique key can race between two identical requests. Resolve that race by
      // returning the row that won instead of creating duplicate device work.
      const { data: raced } = await client
        .from("dj_library_device_jobs")
        .select("id,status,result,error,created_at,updated_at")
        .eq("device_id", deviceId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (raced) return NextResponse.json({ job: raced, idempotent: true });
      throw insertError;
    }

    return NextResponse.json({ job, idempotent: false }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
