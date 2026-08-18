import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyProviderStatus } from "@/lib/video-director/generation";
import type { ProviderStatus } from "@/lib/video-providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validToken(request: Request) {
  const expectedValue = process.env.HIGGSFIELD_WEBHOOK_SECRET?.trim();
  if (!expectedValue) return false;
  const actualValue = new URL(request.url).searchParams.get("token") || "";
  const actual = Buffer.from(actualValue);
  const expected = Buffer.from(expectedValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function POST(request: Request) {
  if (!validToken(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as unknown;
  const payload = record(body);
  const requestId = typeof payload.request_id === "string" ? payload.request_id : "";
  const rawStatus = typeof payload.status === "string" ? payload.status : "";
  if (!requestId || !["queued", "in_progress", "completed", "failed", "nsfw"].includes(rawStatus)) {
    return NextResponse.json({ error: "Invalid Higgsfield callback" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: generation, error } = await db.from("music_video_generations")
    .select("*")
    .eq("provider", "higgsfield")
    .eq("provider_request_id", requestId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!generation) return NextResponse.json({ ok: true, ignored: "unknown_request" });
  if (["completed", "refunded", "rejected_by_provider"].includes(generation.status)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const video = record(payload.video);
  const images = Array.isArray(payload.images) ? payload.images.map(record) : [];
  const resultUrl = typeof video.url === "string"
    ? video.url
    : images.find((image) => typeof image.url === "string")?.url as string | undefined;
  const status: ProviderStatus = {
    requestId,
    status: rawStatus as ProviderStatus["status"],
    resultUrl,
    raw: payload,
  };
  try {
    await applyProviderStatus({ db, generation, status });
  } catch (applyError) {
    await db.from("music_video_generations").update({
      error: applyError instanceof Error ? applyError.message : "Could not reconcile provider callback",
    }).eq("id", generation.id);
    return NextResponse.json({ error: "Callback reconciliation failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
