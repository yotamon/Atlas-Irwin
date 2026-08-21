import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { syncAudienceInteractions } from "@/lib/marketing/audience";
import { fillOneMissingScheduledAsset } from "@/lib/marketing/free-content-factory";
import { refreshNextBestActions } from "@/lib/marketing/next-best-action";
import { processDueOutreachEnrollments } from "@/lib/marketing/outreach";
import { processDuePublicationJobs } from "@/lib/marketing/publications";
import { refreshMarketingRadarIfDue } from "@/lib/marketing/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const freeAsset = await fillOneMissingScheduledAsset();
    const publications = await processDuePublicationJobs();
    const outreach = await processDueOutreachEnrollments();
    const automation = await runMarketingAutomationCycle();
    const audience = await syncAudienceInteractions();
    const radar = await refreshMarketingRadarIfDue();
    const nextBestActions = await refreshNextBestActions();
    return Response.json({ ok: true, freeAsset, publications, outreach, automation, audience, radar, nextBestActions });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Marketing automation failed." },
      { status: 500 },
    );
  }
}
