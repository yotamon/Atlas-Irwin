import { kickAutoMixQueue } from "@/lib/automix/jobs";
import { kickAutoMixPreviewQueue } from "@/lib/automix/previews";
import { kickMasteringQueue } from "@/lib/mastering/jobs";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { runMarketingAutomationCycle } from "@/lib/marketing/automation";
import { syncAudienceInteractions } from "@/lib/marketing/audience";
import { processAutonomousCreativeSpend } from "@/lib/marketing/autonomous-creative-spend";
import { authorizeMarketingCron } from "@/lib/marketing/cron-auth";
import { processApprovedCreativeDerivativeEvents } from "@/lib/marketing/creative-derivative-events";
import { executeSafeManagerActions } from "@/lib/marketing/manager-execution";
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

function dispatched(result: { ok: true; value: { dispatched?: boolean } } | { ok: false; error: string }) {
  return result.ok && result.value.dispatched === true;
}

export async function GET(request: Request) {
  const auth = await authorizeMarketingCron(request);
  if (!auth.authorized) {
    if (!auth.configured) {
      return Response.json({ error: "Marketing cron authentication is not provisioned." }, { status: 503 });
    }
    return new Response("Unauthorized", { status: 401 });
  }

  // The same authenticated 15-minute heartbeat recovers every durable workload that shares the
  // single Media Worker Sandbox. Healthy callbacks still drain these queues immediately; this is
  // the recovery path for interrupted enqueue/dispatch/callback windows.
  const mediaWorker = await runStep("media worker queue", () => kickMediaWorkerQueue());
  const mastering = dispatched(mediaWorker)
    ? { ok: true as const, value: { dispatched: false, reason: "shared-worker-busy" as const } }
    : await runStep("mastering queue", () => kickMasteringQueue());
  const autoMix = dispatched(mediaWorker) || dispatched(mastering)
    ? { ok: true as const, value: { dispatched: false, reason: "shared-worker-busy" as const } }
    : await runStep("AutoMix queue", () => kickAutoMixQueue());
  const autoMixPreview = dispatched(mediaWorker) || dispatched(mastering) || dispatched(autoMix)
    ? { ok: true as const, value: { dispatched: false, reason: "shared-worker-busy" as const } }
    : await runStep("AutoMix preview queue", () => kickAutoMixPreviewQueue());
  const marketingMediaWorker = dispatched(mediaWorker)
    || dispatched(mastering)
    || dispatched(autoMix)
    || dispatched(autoMixPreview)
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

  // Manager execution is intentionally narrower than planning. It may only perform allowlisted,
  // deterministic $0 internal preparation. It cannot publish, contact anyone or spend money.
  const managerExecution = await runStep("safe manager execution", () => executeSafeManagerActions());

  const results = {
    mediaWorker,
    mastering,
    autoMix,
    autoMixPreview,
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
    managerExecution,
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
