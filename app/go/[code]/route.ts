import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createMarketingServiceClient } from "@/lib/marketing/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function visitorHash(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  const salt = process.env.ATTRIBUTION_HASH_SALT?.trim()
    || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "atlas-attribution";
  const rollingWindow = Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));
  return createHash("sha256")
    .update(`${salt}:${rollingWindow}:${ip}:${agent}`)
    .digest("hex");
}

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
    p_visitor_hash: visitorHash(request),
    p_referrer: request.headers.get("referer")?.slice(0, 1000) || null,
    p_user_agent: request.headers.get("user-agent")?.slice(0, 1000) || null,
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
  if (!['http:', 'https:'].includes(destination.protocol)) {
    return new Response("Link unavailable", { status: 404 });
  }

  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}
