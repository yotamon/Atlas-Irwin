import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { completeSoundCloudOAuth } from "@/lib/studio/soundcloud";

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

function redirectWithStatus(request: NextRequest, status: string) {
  return NextResponse.redirect(new URL(`/studio/soundcloud?${status}`, request.url));
}

function soundCloudErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("soundcloud client environment")) return "missing_soundcloud_env";
  if (message.includes("supabase_service_role_key")) return "missing_service_role_key";
  if (
    message.includes("upsert_soundcloud_token") ||
    message.includes("get_soundcloud_token") ||
    message.includes("delete_soundcloud_token") ||
    message.includes("could not find the function")
  ) {
    return "soundcloud_migration_missing";
  }
  if (message.includes("token exchange failed")) return "token_exchange_failed";
  if (message.includes("profile response")) return "profile_fetch_failed";
  return "connection_failed";
}

export async function GET(request: NextRequest) {
  const { user } = await requireStudioAdmin();
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return redirectWithStatus(request, `error=${encodeURIComponent(error)}`);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("soundcloud_oauth_state")?.value;
  const codeVerifier = request.cookies.get("soundcloud_code_verifier")?.value;
  if (!code || !state || !expectedState || state !== expectedState || !codeVerifier) {
    return redirectWithStatus(request, "error=invalid_oauth_state");
  }

  let response: NextResponse;
  try {
    await completeSoundCloudOAuth({
      code,
      codeVerifier,
      origin: requestOrigin(request),
      ownerId: user.id,
    });
    response = redirectWithStatus(request, "connected=1");
  } catch (error) {
    console.error("SoundCloud OAuth callback failed", error);
    response = redirectWithStatus(
      request,
      `error=${soundCloudErrorCode(error)}`,
    );
  }
  response.cookies.delete("soundcloud_oauth_state");
  response.cookies.delete("soundcloud_code_verifier");
  return response;
}
