import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { fillOneMissingScheduledAsset } from "@/lib/marketing/free-content-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Composition itself can be long, but Sandbox is created only after quota + real-work checks pass.
export const maxDuration = 240;

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const result = await fillOneMissingScheduledAsset();
    return Response.json({
      ok: true,
      deferred: result.outcome === "sandbox_capacity_deferred",
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      result,
    });
  } catch (error) {
    console.error("[content-factory-cron] composition cycle failed", error);
    return Response.json({
      ok: false,
      mode: "free-tier-safe-content-factory",
      authSource: auth.source,
      error: error instanceof Error ? error.message : "Content factory cycle failed.",
    }, { status: 500 });
  }
}
