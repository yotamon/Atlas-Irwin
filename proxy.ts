import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalHost,
  isLocalStudioBypassHost,
} from "@/lib/auth/local-studio";
import { ENSEMBLIS_ACTIVE_ARTIST_COOKIE } from "@/lib/ensemblis-product";
import { getSiteUrl } from "@/lib/site-url";
import {
  normalizeRequestHostname,
  resolveSiteHostForProxy,
} from "@/lib/sites/proxy-host-resolver";

const INTERNAL_SITE_ID_HEADER = "x-ensemblis-site-id";
const INTERNAL_SITE_HOST_HEADER = "x-ensemblis-site-host";

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

  if (isLocalHost(host)) return host;
  return normalizeRequestHostname(host);
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

function sanitizedRequestHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_SITE_ID_HEADER);
  headers.delete(INTERNAL_SITE_HOST_HEADER);
  return headers;
}

function nextResponse(request: NextRequest) {
  return NextResponse.next({ request: { headers: sanitizedRequestHeaders(request) } });
}

function isGlobalSystemPath(pathname: string) {
  return [
    "/studio",
    "/api",
    "/site-preview",
    "/sites",
    "/go",
    "/_next",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function addHostAndWwwVariant(hosts: Set<string>, input: string) {
  const hostname = normalizeRequestHostname(input);
  if (!hostname) return;
  hosts.add(hostname);
  hosts.add(hostname.startsWith("www.") ? hostname.slice(4) : `www.${hostname}`);
}

function legacyPublicHosts() {
  const hosts = new Set<string>();

  try {
    addHostAndWwwVariant(hosts, new URL(getSiteUrl()).hostname);
  } catch {
    // getSiteUrl is already defensive; keep this boundary fail-closed regardless.
  }

  const configured = process.env.ENSEMBLIS_SITES_LEGACY_HOSTS
    ?.split(",")
    .map((item) => normalizeRequestHostname(item))
    .filter(Boolean) ?? [];
  configured.forEach((host) => hosts.add(host));

  for (const candidate of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    if (candidate) hosts.add(normalizeRequestHostname(candidate));
  }
  return hosts;
}

function isTrustedNonTenantHost(host: string) {
  if (isLocalHost(host)) return true;
  const normalized = normalizeRequestHostname(host);
  if (normalized.endsWith(".vercel.app")) return true;
  return legacyPublicHosts().has(normalized);
}

async function routeArtistHostname(request: NextRequest, host: string) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/__sites" || pathname.startsWith("/__sites/")) {
    return new NextResponse(null, { status: 404 });
  }
  if (isGlobalSystemPath(pathname)) return null;

  let resolved: Awaited<ReturnType<typeof resolveSiteHostForProxy>> = null;
  try {
    resolved = await resolveSiteHostForProxy(host);
  } catch {
    if (!isTrustedNonTenantHost(host)) {
      return new NextResponse("Site temporarily unavailable.", { status: 503 });
    }
    return null;
  }

  if (!resolved) {
    return isTrustedNonTenantHost(host)
      ? null
      : new NextResponse(null, { status: 404 });
  }

  const requestHeaders = sanitizedRequestHeaders(request);
  requestHeaders.set(INTERNAL_SITE_ID_HEADER, resolved.siteId);
  requestHeaders.set(INTERNAL_SITE_HOST_HEADER, normalizeRequestHostname(host));

  const rewriteUrl = request.nextUrl.clone();
  const suffix = pathname === "/" ? "" : pathname;
  rewriteUrl.pathname = `/__sites/${resolved.siteId}${suffix}`;

  return NextResponse.rewrite(rewriteUrl, {
    request: { headers: requestHeaders },
  });
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

  const hostRoute = await routeArtistHostname(request, host);
  if (hostRoute) return hostRoute;

  const isStudio = request.nextUrl.pathname.startsWith("/studio");
  const isOpenStudioRoute = [
    "/studio/login",
    "/studio/auth/callback",
    "/studio/access-denied",
  ].some((path) => request.nextUrl.pathname.startsWith(path));
  const requestedArtistId = isStudio ? selectedArtistFromRequest(request) : null;

  if (requestedArtistId) {
    request.cookies.set(ENSEMBLIS_ACTIVE_ARTIST_COOKIE, requestedArtistId);
  }

  let response = nextResponse(request);

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
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse(request);
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

export const config = {
  matcher: [
    "/__sites/:path*",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)",
  ],
};
