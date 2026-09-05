import { NextResponse } from "next/server";
import { z } from "zod";
import { createSmartLinksServiceClient } from "@/lib/smart-links/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.uuid();

function safe(value: string | null, max = 200) {
  return value?.trim().slice(0, max) || null;
}

function referrerHost(request: Request) {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try { return new URL(referrer).hostname.slice(0, 255); } catch { return null; }
}

export async function GET(request: Request, { params }: { params: Promise<{ destinationId: string }> }) {
  const { destinationId: rawDestinationId } = await params;
  const destinationId = uuid.safeParse(rawDestinationId);
  if (!destinationId.success) return new Response("Link unavailable", { status: 404 });

  const url = new URL(request.url);
  const siteId = uuid.safeParse(url.searchParams.get("site"));
  const slug = url.searchParams.get("slug")?.trim() || "";
  if (!siteId.success || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return new Response("Link unavailable", { status: 404 });
  }

  const db = createSmartLinksServiceClient();
  const { data, error } = await db.rpc("record_smart_link_event", {
    p_site_id: siteId.data,
    p_slug: slug,
    p_event_type: "outbound_click",
    p_destination_id: destinationId.data,
    p_source_code: safe(url.searchParams.get("src"), 64),
    p_referrer_host: referrerHost(request),
    p_utm_source: safe(url.searchParams.get("utm_source")),
    p_utm_medium: safe(url.searchParams.get("utm_medium")),
    p_utm_campaign: safe(url.searchParams.get("utm_campaign")),
    p_utm_content: safe(url.searchParams.get("utm_content")),
  });
  const target = data?.[0]?.destination_url;
  if (error || !target) return new Response("Link unavailable", { status: 404 });

  let destination: URL;
  try { destination = new URL(target); } catch { return new Response("Link unavailable", { status: 404 }); }
  if (!['http:', 'https:'].includes(destination.protocol)) return new Response("Link unavailable", { status: 404 });

  const response = NextResponse.redirect(destination, 307);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}
