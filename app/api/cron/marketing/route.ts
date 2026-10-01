import { after } from "next/server";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { runDurableMarketingHeartbeat } from "@/lib/marketing/durable-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Return to the cron caller immediately, then use Fluid Compute's Hobby-safe function
// window for bounded durable work. Durable jobs remain the source of truth if an invocation
// ends early; the larger window prevents provider I/O from being killed by our old 55s cap.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  after(async () => {
    try {
      const heartbeat = await runDurableMarketingHeartbeat();
      console.info("[marketing-cron] durable heartbeat completed", {
        ok: heartbeat.ok,
        partial: heartbeat.partial,
        elapsedMs: heartbeat.elapsedMs,
        budgetMs: heartbeat.budgetMs,
        failureCount: heartbeat.failures.length,
      });
    } catch (error) {
      console.error("[marketing-cron] durable heartbeat crashed", error);
    }
  });

  return Response.json({
    ok: true,
    accepted: true,
    mode: "durable-post-response-heartbeat",
    authSource: auth.source,
  });
}
