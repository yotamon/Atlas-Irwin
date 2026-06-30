import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { completeSpotifyOAuth } from "@/lib/studio/spotify";

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function redirectWithStatus(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/studio/spotify?${status}`, request.url));
}

function spotifyErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("spotify client environment")) return "missing_spotify_env";
  if (message.includes("supabase_service_role_key")) return "missing_service_role_key";
  if (message.includes("spotify_token") || message.includes("spotify_accounts")
      || message.includes("spotify_albums") || message.includes("spotify_tracks")
      || message.includes("spotify_playlists") || message.includes("schema cache")) {
    return "spotify_migration_missing";
  }
  if (message.includes("token exchange")) return "token_exchange_failed";
  if (message.includes("profile response")) return "profile_fetch_failed";
  if (message.includes("did not return a refresh token")) return "no_refresh_token";
  if (message.includes("authorization expired")) return "token_expired";
  if (message.includes("api request failed")) return "spotify_api_error";
  return "connection_failed";
}

export async function GET(request: NextRequest) {
  const { user } = await requireStudioAdmin();
  const url = new URL(request.url);
  const oauthError = url.searchParams.get("error");
  if (oauthError) return redirectWithStatus(request, `error=${encodeURIComponent(oauthError)}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("spotify_oauth_state")?.value;
  const codeVerifier = request.cookies.get("spotify_code_verifier")?.value;
  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    return redirectWithStatus(request, "error=invalid_oauth_state");
  }

  let response: NextResponse;
  try {
    await completeSpotifyOAuth({ code, codeVerifier, origin: requestOrigin(request), ownerId: user.id });
    response = redirectWithStatus(request, "connected=1");
  } catch (error) {
    console.error("Spotify OAuth callback failed", error);
    response = redirectWithStatus(request, `error=${spotifyErrorCode(error)}`);
  }
  response.cookies.delete("spotify_oauth_state");
  response.cookies.delete("spotify_code_verifier");
  return response;
}
