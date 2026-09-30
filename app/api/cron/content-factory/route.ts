import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import {
  dispatchFreeContentFactoryJob,
  enqueueOneMissingScheduledAsset,
} from "@/lib/marketing/free-content-factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const scheduled = await enqueueOneMissingScheduledAsset();
    const dispatch = "jobId" in scheduled && scheduled.jobStatus === "queued"
      ? await dispatchFreeContentFactoryJob(scheduled.jobId)
      : { dispatched: false, reason: "not_queued" as const };

    return Response.json({
      ok: true,
      mode: "durable-free-content-factory",
      authSource: auth.source,
      scheduled,
      dispatch,
    });
  } catch (error) {
    console.error("[content-factory-cron] durable dispatch failed", error);
    return Response.json({
      ok: false,
      mode: "durable-free-content-factory",
      authSource: auth.source,
      error: error instanceof Error ? error.message : "Content Factory dispatch failed.",
    }, { status: 500 });
  }
}
