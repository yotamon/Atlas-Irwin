import { NextResponse, type NextRequest } from "next/server";

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

function isLocalHost(host: string | undefined) {
  return (
    !host ||
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  );
}

export function proxy(request: NextRequest) {
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

  return NextResponse.next();
}
