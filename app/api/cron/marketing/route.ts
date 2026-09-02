import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { syncAudienceInteractions } from "@/lib/marketing/audience";
import { processAutonomousCreativeSpend } from "@/lib/marketing/autonomous-creative-spend";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { processApprovedCreativeDerivativeEvents } from "@/lib/marketing/creative-derivative-events";
import { kickMarketingMediaWorkerQueue } from "@/lib/marketing/media-worker-queue";
import { refreshNextBestActions } from "@/lib/marketing/next-best-action";
import { processDueOutreachEnrollments } from "@/lib/marketing/outreach";
import { processDuePublicationJobs } from "@/lib/marketing/publications";
import { refreshMarketingRadarIfDue } from "@/lib/marketing/radar";
import { reconcileMarketingState } from "@/lib/marketing/state-reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keep the lightweight heartbeat comfortably inside Hobby function limits.
export const maxDuration = 55;

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
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  // The same authenticated 15-minute heartbeat recovers all durable Media Worker queues after
  // an interrupted dispatch/callback window. Healthy callbacks still drain the shared worker immediately.
  const mediaWorker = await runStep("media worker queue", () => kickMediaWorkerQueue());
  const marketingMediaWorker = mediaWorker.ok && mediaWorker.value.dispatched
    ? { ok: true as const, value: { dispatched: false, reason: "shared-worker-busy" as const } }
    : await runStep("marketing media worker queue", () => kickMarketingMediaWorkerQueue());

  // Repair lifecycle and durable state before any external effect is considered. This step is
  // deterministic and $0: it advances campaign phases, creates missing safe production queues,
  // retires unambiguous orphan generation runs and prepares publication approvals for ready assets.
  const stateReconciliation = await runStep("state reconciliation", () => reconcileMarketingState());

  // Publishing is first among external marketing effects because it is the most time-sensitive.
  const publications = await runStep("publication queue", () => processDuePublicationJobs());
  const outreach = await runStep("outreach queue", () => processDueOutreachEnrollments());

  // Spend is permitted only for autopilot campaigns with an explicitly enabled atomic envelope.
  // Campaign mode alone is never authority to call a paid creative provider.
  const autonomousCreativeSpend = await runStep("autonomous creative spend", () => processAutonomousCreativeSpend());

  // Consume human-approved master creatives before the generic event processor marks unknown
  // event types processed. Derivatives use deterministic repackaging and never create new media spend.
  const creativeDerivatives = await runStep("creative derivatives", () => processApprovedCreativeDerivativeEvents());
  const automation = await runStep("marketing event automation", () => runMarketingAutomationCycle());
  const audience = await runStep("audience sync", () => syncAudienceInteractions());
  const radar = await runStep("marketing radar", () => refreshMarketingRadarIfDue());
  const nextBestActions = await runStep("next best actions", () => refreshNextBestActions());

  const results = {
    mediaWorker,
    marketingMediaWorker,
    stateReconciliation,
    publications,
    outreach,
    autonomousCreativeSpend,
    creativeDerivatives,
    automation,
    audience,
    radar,
    nextBestActions,
  };
  const failures = Object.entries(results)
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => ({ name, error: "error" in result ? result.error : "Unknown failure." }));

  return Response.json({
    ok: failures.length === 0,
    partial: failures.length > 0,
    mode: "free-tier-safe-heartbeat",
    authSource: auth.source,
    failures,
    ...results,
  });
}
