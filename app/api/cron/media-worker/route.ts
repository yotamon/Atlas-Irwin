import { kickAutoMixQueue } from "@/lib/automix/jobs";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const mediaWorker = await kickMediaWorkerQueue();
    const sharedWorkerBlocked = mediaWorker.dispatched
      || mediaWorker.reason === "busy"
      || mediaWorker.reason === "capacity";
    const automix = sharedWorkerBlocked
      ? {
          dispatched: false,
          busy: mediaWorker.reason === "busy",
          deferred: true,
          reason: mediaWorker.reason,
          retryAt: "retryAt" in mediaWorker ? mediaWorker.retryAt : null,
        }
      : await kickAutoMixQueue();
    return Response.json({ ok: true, authSource: auth.source, queue: { mediaWorker, automix } });
  } catch (error) {
    console.error("[media-worker-cron] queue kick failed", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Media Worker queue kick failed.",
    }, { status: 500 });
  }
}
