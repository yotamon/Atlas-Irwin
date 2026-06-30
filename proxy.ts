import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalHost,
  isLocalStudioBypassHost,
} from "@/lib/auth/local-studio";

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

  let response = NextResponse.next({ request });
  const isStudio = request.nextUrl.pathname.startsWith("/studio");
  const isOpenStudioRoute = [
    "/studio/login",
    "/studio/auth/callback",
    "/studio/access-denied",
  ].some((path) => request.nextUrl.pathname.startsWith(path));

  if (isStudio && isLocalStudioBypassHost(host)) {
    if (request.nextUrl.pathname === "/studio/login") {
      return NextResponse.redirect(new URL("/studio", request.url));
    }

    if (!isOpenStudioRoute) return response;
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    if (isStudio && !isOpenStudioRoute)
      return NextResponse.redirect(
        new URL(
          "/studio/login?error=Studio%20is%20not%20configured",
          request.url,
        ),
      );
    return response;
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
  if (isStudio && !isOpenStudioRoute && !data.user)
    return NextResponse.redirect(new URL("/studio/login", request.url));
  if (isStudio && !isOpenStudioRoute && !isStudioAdmin(data.user?.email))
    return NextResponse.redirect(new URL("/studio/access-denied", request.url));
  if (
    request.nextUrl.pathname === "/studio/login" &&
    data.user &&
    isStudioAdmin(data.user.email)
  )
    return NextResponse.redirect(new URL("/studio", request.url));
  return response;
}

export const config = { matcher: ["/studio/:path*"] };
