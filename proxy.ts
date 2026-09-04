import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalHost,
  isLocalStudioBypassHost,
} from "@/lib/auth/local-studio";
import { ENSEMBLIS_ACTIVE_ARTIST_COOKIE } from "@/lib/ensemblis-product";

function isStudioAdmin(email?: string | null) {
  return Boolean(
    email &&
      (process.env.STUDIO_ADMIN_EMAILS ?? "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .includes(email.toLowerCase()),
  );
}

function getForwardedValue(request: NextRequest, headerName: string) {
  return request.headers.get(headerName)?.split(",")[0]?.trim();
}

function getRequestHost(request: NextRequest) {
  const host =
    getForwardedValue(request, "x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;

  if (isLocalHost(host)) {
    return host;
  }

  return host.replace(/:\d+$/, "");
}

function selectedArtistFromRequest(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("artist")?.trim();
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function persistArtistPreference(response: NextResponse, artistId: string | null) {
  if (!artistId) return response;
  response.cookies.set(ENSEMBLIS_ACTIVE_ARTIST_COOKIE, artistId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/studio",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function proxy(request: NextRequest) {
  const host = getRequestHost(request);
  const forwardedProto = getForwardedValue(request, "x-forwarded-proto");
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");

  if (
    process.env.NODE_ENV === "production" &&
    protocol === "http" &&
    !isLocalHost(host)
  ) {
    const secureUrl = request.nextUrl.clone();
    secureUrl.protocol = "https:";
    secureUrl.host = host;
    secureUrl.port = "";

    return NextResponse.redirect(secureUrl, 308);
  }

  const isStudio = request.nextUrl.pathname.startsWith("/studio");
  const isOpenStudioRoute = [
    "/studio/login",
    "/studio/auth/callback",
    "/studio/access-denied",
  ].some((path) => request.nextUrl.pathname.startsWith(path));
  const requestedArtistId = isStudio ? selectedArtistFromRequest(request) : null;

  if (requestedArtistId) {
    // This value is still untrusted. ArtistContext validates membership before use.
    request.cookies.set(ENSEMBLIS_ACTIVE_ARTIST_COOKIE, requestedArtistId);
  }

  let response = NextResponse.next({ request });

  if (isStudio && isLocalStudioBypassHost(host)) {
    if (request.nextUrl.pathname === "/studio/login") {
      return persistArtistPreference(
        NextResponse.redirect(new URL("/studio", request.url)),
        requestedArtistId,
      );
    }

    if (!isOpenStudioRoute) {
      return persistArtistPreference(response, requestedArtistId);
    }
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    if (isStudio && !isOpenStudioRoute) {
      return persistArtistPreference(
        NextResponse.redirect(
          new URL(
            "/studio/login?error=Ensemblis%20is%20not%20configured",
            request.url,
          ),
        ),
        requestedArtistId,
      );
    }
    return persistArtistPreference(response, requestedArtistId);
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headersToSet) => {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headersToSet).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  if (isStudio && !isOpenStudioRoute && !data.user) {
    return persistArtistPreference(
      NextResponse.redirect(new URL("/studio/login", request.url)),
      requestedArtistId,
    );
  }
  if (isStudio && !isOpenStudioRoute && !isStudioAdmin(data.user?.email)) {
    return persistArtistPreference(
      NextResponse.redirect(new URL("/studio/access-denied", request.url)),
      requestedArtistId,
    );
  }
  if (
    request.nextUrl.pathname === "/studio/login" &&
    data.user &&
    isStudioAdmin(data.user.email)
  ) {
    return persistArtistPreference(
      NextResponse.redirect(new URL("/studio", request.url)),
      requestedArtistId,
    );
  }

  return persistArtistPreference(response, requestedArtistId);
}

export const config = { matcher: ["/studio/:path*"] };
