import { NextResponse } from "next/server";
import { mediaWorkerReadiness } from "@/lib/video-director/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = mediaWorkerReadiness();
  const configured = readiness.configured;

  return NextResponse.json({
    configured,
    reachable: configured,
    worker_version: 2.2,
    dispatch_mode: "vercel_sandbox",
    durable_dispatch: true,
    automatic_retries: false,
    zero_cost_mode: true,
    hobby_safe_concurrency: 1,
    sandbox_image: readiness.image,
    sandbox_name: readiness.sandboxName,
    cache_mode: "persistent_single_snapshot",
    music_intelligence_v2: true,
    // The semantic model is verified when the VCR image is built and on the first real job.
    // Avoid pretending that a static health route has booted PyTorch just to prove readiness.
    semantic_analyzer_available: null,
    runtime_verified: false,
  }, { status: configured ? 200 : 503 });
}
