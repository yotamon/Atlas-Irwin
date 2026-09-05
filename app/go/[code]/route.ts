import { NextResponse } from "next/server";
import { createMarketingServiceClient } from "@/lib/marketing/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) {
    return new Response("Link unavailable", { status: 404 });
  }

  const client = createMarketingServiceClient();
  const { data, error } = await client.rpc("record_attribution_click", {
    p_code: code,
    // The privacy-safe replacement intentionally ignores legacy visitor identity.
    // Use an empty compatibility value because the older generated RPC type predates nullable input.
    p_visitor_hash: "",
    p_referrer: request.headers.get("referer")?.slice(0, 1000) || null,
    p_user_agent: null,
  });
  const target = data?.[0]?.destination_url;
  if (error || !target) {
    return new Response("Link unavailable", { status: 404 });
  }

  let destination: URL;
  try {
    destination = new URL(target);
  } catch {
    return new Response("Link unavailable", { status: 404 });
  }
  if (!["http:", "https:"].includes(destination.protocol)) {
    return new Response("Link unavailable", { status: 404 });
  }

  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}