import { NextResponse, type NextRequest } from "next/server";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { isSocialPlatformKey } from "@/lib/marketing/social-platforms";
import { completeSocialOAuth } from "@/lib/studio/social-connections";

function requestOrigin(request: NextRequest) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const protocol = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

function redirectToPlatform(request: NextRequest, platform: string, query: string) {
  return NextResponse.redirect(
    new URL(`/studio/settings/social/${platform}?${query}`, request.url),
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { user } = await requireStudioAdmin();
  const { platform } = await params;
  if (!isSocialPlatformKey(platform)) {
    return NextResponse.redirect(new URL("/studio/settings?social_error=unsupported_platform", request.url));
  }

  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return redirectToPlatform(
      request,
      platform,
      `error=${encodeURIComponent(url.searchParams.get("error_description") || providerError)}`,
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieName = `atlas_social_${platform}_state`;
  const expectedState = request.cookies.get(cookieName)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToPlatform(request, platform, "error=invalid_oauth_state");
  }

  let response: NextResponse;
  try {
    await completeSocialOAuth({
      ownerId: user.id,
      platform,
      code,
      origin: requestOrigin(request),
    });
    response = redirectToPlatform(request, platform, "connected=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Social connection failed.";
    console.error(`${platform} OAuth callback failed:`, message, error);
    response = redirectToPlatform(request, platform, `error=${encodeURIComponent(message)}`);
  }
  response.cookies.delete(cookieName);
  return response;
}
