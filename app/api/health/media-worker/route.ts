import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function workerUrl() {
  return process.env.MEDIA_WORKER_URL?.trim().replace(/\/$/, "") || null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET() {
  const base = workerUrl();
  if (!base) {
    return NextResponse.json({
      configured: false,
      reachable: false,
      worker_version: null,
      music_intelligence_v2: false,
      semantic_analyzer_available: false,
    }, { status: 503 });
  }

  try {
    const response = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = record(await response.json().catch(() => null));
    const intelligence = record(payload.music_intelligence);
    const version = typeof payload.version === "number" ? payload.version : null;

    return NextResponse.json({
      configured: true,
      reachable: response.ok,
      worker_version: version,
      music_intelligence_v2: response.ok && version !== null && version >= 2,
      semantic_analyzer_available: intelligence.semantic_analyzer_available === true,
    }, { status: response.ok ? 200 : 503 });
  } catch {
    return NextResponse.json({
      configured: true,
      reachable: false,
      worker_version: null,
      music_intelligence_v2: false,
      semantic_analyzer_available: false,
    }, { status: 503 });
  }
}
