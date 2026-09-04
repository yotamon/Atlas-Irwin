import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { isSocialPlatformKey } from "@/lib/marketing/social-platforms";
import { createAutomationSocialAuthorizeUrl } from "@/lib/marketing/social-oauth";
import {
  resolveArtistContext,
  resolveDefaultArtistContext,
} from "@/lib/studio/artist-context";

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { supabase, user } = await requireStudioAdmin();
  const { platform } = await params;
  if (!isSocialPlatformKey(platform)) {
    return NextResponse.redirect(new URL("/studio/settings?social_error=unsupported_platform", request.url));
  }

  try {
    const requestedArtistId = new URL(request.url).searchParams.get("artist_id")?.trim() || null;
    const artist = requestedArtistId
      ? await resolveArtistContext(supabase, user, requestedArtistId)
      : await resolveDefaultArtistContext(supabase, user);
    const oauth = createAutomationSocialAuthorizeUrl(platform, requestOrigin(request));
    const state = `${oauth.state}.${artist.artistId}`;
    oauth.url.searchParams.set("state", state);

    const response = NextResponse.redirect(oauth.url);
    response.cookies.set(`atlas_social_${platform}_state`, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60,
      path: `/studio/settings/social/${platform}`,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start OAuth connection.";
    return NextResponse.redirect(
      new URL(`/studio/settings/social/${platform}?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
