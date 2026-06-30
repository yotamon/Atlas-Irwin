import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createSoundCloudAuthorizeUrl } from "@/lib/studio/soundcloud";

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    url.host;
  const protocol =
    request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  await requireStudioAdmin();
  const { url, state, codeVerifier } = createSoundCloudAuthorizeUrl(
    requestOrigin(request),
  );
  const response = NextResponse.redirect(url);
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set("soundcloud_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 10 * 60,
    path: "/studio/soundcloud",
  });
  response.cookies.set("soundcloud_code_verifier", codeVerifier, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    maxAge: 10 * 60,
    path: "/studio/soundcloud",
  });
  return response;
}
