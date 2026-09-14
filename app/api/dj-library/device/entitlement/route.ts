import { NextResponse } from "next/server";
import { DeviceRequestError, authenticateLibraryDevice } from "@/lib/dj-library/device-server";
import { issueDeviceEntitlement } from "@/lib/licensing/entitlement-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  if (error instanceof DeviceRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: "Could not refresh desktop entitlements." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const { device } = await authenticateLibraryDevice(request);
    const issued = await issueDeviceEntitlement(device);
    return NextResponse.json({
      version: "ensemblis.desktop-entitlement-response.v1",
      token: issued.token,
      publicKey: issued.publicKey,
    });
  } catch (error) {
    return failure(error);
  }
}
