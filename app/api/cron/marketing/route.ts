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

async function runStep<T>(name: string, task: () => Promise<T>) {
  try {
    return { ok: true as const, value: await task() };
  } catch (error) {
    console.error(`[marketing-cron] ${name} failed`, error);
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : `${name} failed.`,
    };
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const freeAsset = await runStep("free content factory", () => fillOneMissingScheduledAsset());
  const publications = await runStep("publication queue", () => processDuePublicationJobs());
  const outreach = await runStep("outreach queue", () => processDueOutreachEnrollments());
  const automation = await runStep("marketing event automation", () => runMarketingAutomationCycle());
  const audience = await runStep("audience sync", () => syncAudienceInteractions());
  const radar = await runStep("marketing radar", () => refreshMarketingRadarIfDue());
  const nextBestActions = await runStep("next best actions", () => refreshNextBestActions());

  const results = { freeAsset, publications, outreach, automation, audience, radar, nextBestActions };
  const failures = Object.entries(results)
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => ({ name, error: "error" in result ? result.error : "Unknown failure." }));

  return Response.json({
    ok: failures.length === 0,
    partial: failures.length > 0,
    failures,
    ...results,
  });
}
