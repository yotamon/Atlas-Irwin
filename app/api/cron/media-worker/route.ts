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
    const queue = await kickMediaWorkerQueue();
    return Response.json({ ok: true, authSource: auth.source, queue });
  } catch (error) {
    console.error("[media-worker-cron] queue kick failed", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Media Worker queue kick failed.",
    }, { status: 500 });
  }
}
