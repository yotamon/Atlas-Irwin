import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  DeviceRequestError,
  createDjLibraryServiceClient,
  generatePairingCode,
  pairingCodeHash,
  record,
} from "@/lib/dj-library/device-server";
import { resolveArtistContext } from "@/lib/studio/artist-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function context(artistId: string) {
  if (!UUID_RE.test(artistId)) {
    throw new DeviceRequestError("A valid artistId is required.");
  }
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveArtistContext(supabase, user, artistId);
  return { ownerId: user.id, artistId: artist.artistId };
}

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not update Library Bridge devices." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const artistId = new URL(request.url).searchParams.get("artistId")?.trim() ?? "";
    const scope = await context(artistId);
    const client = createDjLibraryServiceClient();
    const [{ data: devices, error: devicesError }, { data: sources, error: sourcesError }] = await Promise.all([
      client
        .from("dj_library_devices")
        .select("id,public_id,name,platform,app_version,credential_prefix,capabilities,paired_at,last_seen_at,revoked_at,created_at,updated_at")
        .eq("owner_id", scope.ownerId)
        .eq("artist_id", scope.artistId)
        .order("paired_at", { ascending: false }),
      client
        .from("dj_library_device_sources")
        .select("id,device_id,source_id,source_kind,revision,track_count,last_synced_at,updated_at")
        .eq("owner_id", scope.ownerId)
        .eq("artist_id", scope.artistId)
        .order("updated_at", { ascending: false }),
    ]);
    if (devicesError || sourcesError) throw devicesError ?? sourcesError;

    return NextResponse.json({ devices: devices ?? [], sources: sources ?? [] });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
    const action = typeof body.action === "string" ? body.action : "";
    const scope = await context(artistId);
    const client = createDjLibraryServiceClient();

    if (action === "create_pairing") {
      const code = generatePairingCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await client
        .from("dj_library_pairing_codes")
        .delete()
        .eq("owner_id", scope.ownerId)
        .eq("artist_id", scope.artistId)
        .is("used_at", null);
      const { error } = await client.from("dj_library_pairing_codes").insert({
        owner_id: scope.ownerId,
        artist_id: scope.artistId,
        code_hash: pairingCodeHash(code),
        expires_at: expiresAt,
      });
      if (error) throw error;
      return NextResponse.json({ code, expiresAt });
    }

    if (action === "revoke") {
      const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
      if (!UUID_RE.test(deviceId)) {
        throw new DeviceRequestError("A valid deviceId is required.");
      }
      const now = new Date().toISOString();
      const { data: revoked, error } = await client
        .from("dj_library_devices")
        .update({ revoked_at: now })
        .eq("id", deviceId)
        .eq("owner_id", scope.ownerId)
        .eq("artist_id", scope.artistId)
        .is("revoked_at", null)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!revoked) {
        return NextResponse.json({ error: "Library Bridge device was not found or was already revoked." }, { status: 404 });
      }
      await Promise.all([
        client
          .from("dj_library_device_jobs")
          .update({ status: "cancelled", completed_at: now })
          .eq("device_id", deviceId)
          .in("status", ["queued", "claimed"]),
        client.from("dj_library_sync_chunks").delete().eq("device_id", deviceId),
      ]);
      return NextResponse.json({ revoked: true, deviceId });
    }

    throw new DeviceRequestError("Unsupported Library Bridge device action.");
  } catch (error) {
    return failure(error);
  }
}
