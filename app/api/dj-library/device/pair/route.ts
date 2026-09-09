import { NextResponse } from "next/server";
import {
  DEVICE_PAIR_VERSION,
  DeviceRequestError,
  boundedString,
  createDjLibraryServiceClient,
  deviceCredentialDisplayPrefix,
  deviceCredentialHash,
  generateDeviceCredential,
  normalizePairingCode,
  pairingCodeHash,
  record,
  requireBodyWithin,
  sanitizeCapabilities,
} from "@/lib/dj-library/device-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLATFORMS = new Set(["windows", "macos", "linux"]);

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not pair this Library Bridge device." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    requireBodyWithin(request, 32 * 1024);
    const body = record(await request.json().catch(() => null));
    if (body.version !== DEVICE_PAIR_VERSION) {
      throw new DeviceRequestError("Unsupported Library Bridge pairing contract.");
    }

    const pairingCode = boundedString(body.pairingCode, 32, "pairingCode", { required: true });
    const normalizedCode = normalizePairingCode(pairingCode);
    if (normalizedCode.length !== 16) {
      throw new DeviceRequestError("Pairing code is invalid.");
    }

    const publicId = boundedString(body.publicId, 64, "publicId", { required: true });
    if (!UUID_RE.test(publicId)) {
      throw new DeviceRequestError("Device publicId is invalid.");
    }
    const name = boundedString(body.name, 120, "name", { required: true });
    const platform = boundedString(body.platform, 16, "platform", { required: true });
    if (!PLATFORMS.has(platform)) {
      throw new DeviceRequestError("Device platform is not supported.");
    }
    const appVersion = boundedString(body.appVersion, 80, "appVersion") || "unknown";
    const capabilities = sanitizeCapabilities(body.capabilities);

    const credential = generateDeviceCredential();
    const client = createDjLibraryServiceClient();
    const { data, error } = await client.rpc("claim_dj_library_pairing", {
      p_code_hash: pairingCodeHash(pairingCode),
      p_public_id: publicId,
      p_name: name,
      p_platform: platform,
      p_app_version: appVersion,
      p_credential_hash: deviceCredentialHash(credential),
      p_credential_prefix: deviceCredentialDisplayPrefix(credential),
      p_capabilities: capabilities,
    });

    if (error || !data?.[0]) {
      const invalid = error?.message?.includes("invalid_or_expired_pairing_code");
      if (invalid) {
        return NextResponse.json({ error: "Pairing code is invalid or expired." }, { status: 401 });
      }
      throw error ?? new Error("pairing did not return a device");
    }

    return NextResponse.json({
      version: DEVICE_PAIR_VERSION,
      deviceId: data[0].device_id,
      artistId: data[0].artist_id,
      credential,
    });
  } catch (error) {
    return failure(error);
  }
}
