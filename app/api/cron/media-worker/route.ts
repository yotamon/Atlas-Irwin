import { kickAutoMixQueue } from "@/lib/automix/jobs";
import { kickAutoMixPreviewQueue } from "@/lib/automix/previews";
import { kickMasteringQueue } from "@/lib/mastering/jobs";
import { kickMasteringReferenceQueue } from "@/lib/mastering/reference-jobs";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { kickMarketingMediaWorkerQueue } from "@/lib/marketing/media-worker-queue";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

type QueueKickResult = {
  dispatched?: boolean;
  busy?: boolean;
  reason?: string;
  retryAt?: string | null;
};

function blocksSharedWorker(result: QueueKickResult) {
  return result.dispatched === true
    || result.busy === true
    || result.reason === "busy"
    || result.reason === "capacity"
    || result.reason === "started";
}

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const queue: Record<string, QueueKickResult> = {};

    const mediaWorker = await kickMediaWorkerQueue();
    queue.mediaWorker = mediaWorker;
    let blocked = blocksSharedWorker(mediaWorker);

    if (!blocked) {
      const mastering = await kickMasteringQueue();
      queue.mastering = mastering;
      blocked = blocksSharedWorker(mastering);
    }

    if (!blocked) {
      const masteringReference = await kickMasteringReferenceQueue();
      queue.masteringReference = masteringReference;
      blocked = blocksSharedWorker(masteringReference);
    }

    if (!blocked) {
      const autoMix = await kickAutoMixQueue();
      queue.autoMix = autoMix;
      blocked = blocksSharedWorker(autoMix);
    }

    if (!blocked) {
      const autoMixPreview = await kickAutoMixPreviewQueue();
      queue.autoMixPreview = autoMixPreview;
      blocked = blocksSharedWorker(autoMixPreview);
    }

    if (!blocked) {
      const marketingMediaWorker = await kickMarketingMediaWorkerQueue();
      queue.marketingMediaWorker = marketingMediaWorker;
    }

    return Response.json({ ok: true, authSource: auth.source, queue });
  } catch (error) {
    console.error("[media-worker-cron] queue kick failed", error);
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Media Worker queue kick failed.",
    }, { status: 500 });
  }
}
