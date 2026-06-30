import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createSpotifyAuthorizeUrl } from "@/lib/studio/spotify";

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(request: NextRequest) {
  await requireStudioAdmin();
  const { url, state, codeVerifier } = createSpotifyAuthorizeUrl(requestOrigin(request));
  const response = NextResponse.redirect(url);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/studio/spotify",
  };
  response.cookies.set("spotify_oauth_state", state, options);
  response.cookies.set("spotify_code_verifier", codeVerifier, options);
  return response;
}
