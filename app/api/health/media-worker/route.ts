import { NextResponse } from "next/server";
import { mediaWorkerReadiness } from "@/lib/media-worker/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = mediaWorkerReadiness();
  if (!readiness.configured) {
    return NextResponse.json({
      configured: false,
      reachable: false,
      worker_version: readiness.workerVersion,
      dispatch_mode: readiness.runtime,
      durable_dispatch: false,
      music_intelligence_v2: true,
      semantic_analyzer_available: false,
      zero_idle_compute: true,
    }, { status: 503 });
  }

  return NextResponse.json({
    configured: true,
    reachable: true,
    worker_version: readiness.workerVersion,
    dispatch_mode: readiness.runtime,
    durable_dispatch: true,
    music_intelligence_v2: true,
    semantic_analyzer_available: true,
    zero_idle_compute: true,
    sandbox_name: readiness.sandboxName,
  });
}
