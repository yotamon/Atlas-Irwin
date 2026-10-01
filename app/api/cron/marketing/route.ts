import { after } from "next/server";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { runDurableMarketingHeartbeat } from "@/lib/marketing/durable-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Return to the cron caller immediately, then use the remaining function window for
// bounded durable work. Production has demonstrated an effective ~55-second ceiling,
// so continuation must come from persisted jobs rather than a longer assumed runtime.
export const maxDuration = 55;

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
