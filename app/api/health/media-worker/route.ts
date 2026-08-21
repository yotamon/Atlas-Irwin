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

function unavailable(configured: boolean) {
  return {
    configured,
    reachable: false,
    worker_version: null,
    dispatch_mode: null,
    durable_dispatch: false,
    music_intelligence_v2: false,
    semantic_analyzer_available: false,
  };
}

export async function GET() {
  const base = workerUrl();
  if (!base) return NextResponse.json(unavailable(false), { status: 503 });

  try {
    const response = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload = record(await response.json().catch(() => null));
    const intelligence = record(payload.music_intelligence);
    const version = typeof payload.version === "number" ? payload.version : null;
    const dispatchMode = typeof payload.dispatch_mode === "string" ? payload.dispatch_mode : null;
    const durableDispatch = dispatchMode === "cloud_tasks";
    const semanticAnalyzerAvailable = intelligence.semantic_analyzer_available === true;
    const musicIntelligenceV2 = response.ok && version !== null && version >= 2;
    const productionReady = response.ok && musicIntelligenceV2 && durableDispatch && semanticAnalyzerAvailable;

    return NextResponse.json({
      configured: true,
      reachable: response.ok,
      worker_version: version,
      dispatch_mode: dispatchMode,
      durable_dispatch: durableDispatch,
      music_intelligence_v2: musicIntelligenceV2,
      semantic_analyzer_available: semanticAnalyzerAvailable,
    }, { status: productionReady ? 200 : 503 });
  } catch {
    return NextResponse.json(unavailable(true), { status: 503 });
  }
}
