import { NextResponse } from "next/server";
import { z } from "zod";
import { createSmartLinksServiceClient } from "@/lib/smart-links/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  siteId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  sourceCode: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
  utmSource: z.string().max(200).nullable().optional(),
  utmMedium: z.string().max(200).nullable().optional(),
  utmCampaign: z.string().max(200).nullable().optional(),
  utmContent: z.string().max(200).nullable().optional(),
});

function referrerHost(request: Request) {
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try { return new URL(referrer).hostname.slice(0, 255); } catch { return null; }
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof payloadSchema>;
  try {
    parsed = payloadSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const db = createSmartLinksServiceClient();
  const { data, error } = await db.rpc("record_smart_link_event", {
    p_site_id: parsed.siteId,
    p_slug: parsed.slug,
    p_event_type: "landing_view",
    p_destination_id: null,
    p_source_code: parsed.sourceCode ?? null,
    p_referrer_host: referrerHost(request),
    p_utm_source: parsed.utmSource ?? null,
    p_utm_medium: parsed.utmMedium ?? null,
    p_utm_campaign: parsed.utmCampaign ?? null,
    p_utm_content: parsed.utmContent ?? null,
  });
  if (error || !data?.length) return NextResponse.json({ ok: false }, { status: 404 });

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
