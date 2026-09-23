import { NextResponse } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createDjLibraryServiceClient, DeviceRequestError, record } from "@/lib/dj-library/device-server";
import { issueDeviceEntitlement } from "@/lib/licensing/entitlement-token";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import type { DjLibraryDeviceRow } from "@/types/dj-library-bridge-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not issue this Ensemblis Studio license." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const body = record(await request.json().catch(() => null));
    const artistId = typeof body.artistId === "string" ? body.artistId.trim() : "";
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    if (!UUID_RE.test(artistId) || !UUID_RE.test(deviceId)) {
      throw new DeviceRequestError("A valid artistId and deviceId are required.");
    }

    const { supabase, user } = await requireStudioAdmin();
    const artist = await resolveArtistContext(supabase, user, artistId);
    const client = createDjLibraryServiceClient();
    const { data, error } = await client
      .from("dj_library_devices")
      .select("*")
      .eq("id", deviceId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new DeviceRequestError("The paired Library Bridge device was not found.", 404);

    const entitlement = await issueDeviceEntitlement(data as DjLibraryDeviceRow);
    const document = {
      version: "ensemblis.desktop-license.v1",
      deviceId: data.id,
      issuedAt: new Date().toISOString(),
      publicKey: entitlement.publicKey,
      token: entitlement.token,
    };
    return new NextResponse(`${JSON.stringify(document, null, 2)}\n`, {
      status: 200,
      headers: {
        "content-type": "application/vnd.ensemblis.license+json; charset=utf-8",
        "content-disposition": `attachment; filename="Ensemblis-Studio-${data.public_id}.license"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
