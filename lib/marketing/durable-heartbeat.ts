import "server-only";

import { kickAutoMixQueue } from "@/lib/automix/jobs";
import { kickAutoMixPreviewQueue } from "@/lib/automix/previews";
import { kickMasteringQueue } from "@/lib/mastering/jobs";
import { kickMasteringReferenceQueue } from "@/lib/mastering/reference-jobs";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { recoverStrandedMusicIngestionFollowUp } from "@/lib/music-intelligence/ingestion-follow-up";
import { createServiceClient } from "@/lib/supabase/service";
import { runDueAutomationJobsWithinBudget } from "./automation";
import { listActiveMarketingArtistScopes } from "./artist-scopes";
import { createMarketingServiceClient } from "./db";
import { MARKETING_MAINTENANCE_JOBS } from "./maintenance";
import { kickMarketingMediaWorkerQueue } from "./media-worker-queue";

const DEFAULT_HEARTBEAT_BUDGET_MS = 180_000;
const SEED_CONCURRENCY = 12;

type QueueKickResult = {
  dispatched?: boolean;
  busy?: boolean;
  reason?: string;
  retryAt?: string | null;
};

function duplicateError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("duplicate") || normalized.includes("unique");
}

async function runStep<T>(name: string, task: () => Promise<T>) {
  try {
    return { ok: true as const, value: await task() };
  } catch (error) {
    console.error(`[marketing-heartbeat] ${name} failed`, error);
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : `${name} failed.`,
    };
  }
}

function sharedWorkerBlocked(result: { ok: true; value: QueueKickResult } | { ok: false; error: string }) {
  if (!result.ok) return false;
  const value = result.value;
  return value.dispatched === true
    || value.busy === true
    || value.reason === "busy"
    || value.reason === "capacity"
    || value.reason === "started";
}

async function runSharedWorkerRecovery() {
  const results: Record<string, unknown> = {};

  const mediaWorker = await runStep("media worker queue", () => kickMediaWorkerQueue());
  results.mediaWorker = mediaWorker;
  if (sharedWorkerBlocked(mediaWorker)) return { blockedBy: "mediaWorker", results };

  const mastering = await runStep("mastering queue", () => kickMasteringQueue());
  results.mastering = mastering;
  if (sharedWorkerBlocked(mastering)) return { blockedBy: "mastering", results };

  const masteringReference = await runStep(
    "mastering reference queue",
    () => kickMasteringReferenceQueue(),
  );
  results.masteringReference = masteringReference;
  if (sharedWorkerBlocked(masteringReference)) {
    return { blockedBy: "masteringReference", results };
  }

  const autoMix = await runStep("AutoMix queue", () => kickAutoMixQueue());
  results.autoMix = autoMix;
  if (sharedWorkerBlocked(autoMix)) return { blockedBy: "autoMix", results };

  const autoMixPreview = await runStep("AutoMix preview queue", () => kickAutoMixPreviewQueue());
  results.autoMixPreview = autoMixPreview;
  if (sharedWorkerBlocked(autoMixPreview)) return { blockedBy: "autoMixPreview", results };

  const marketingMediaWorker = await runStep(
    "marketing media worker queue",
    () => kickMarketingMediaWorkerQueue(),
  );
  results.marketingMediaWorker = marketingMediaWorker;
  return {
    blockedBy: sharedWorkerBlocked(marketingMediaWorker) ? "marketingMediaWorker" : null,
    results,
  };
}

export async function seedMarketingMaintenanceJobs() {
  const scopes = await listActiveMarketingArtistScopes();
  const client = createMarketingServiceClient();
  const now = Date.now();
  const rows = scopes.flatMap((scope) =>
    MARKETING_MAINTENANCE_JOBS.map((task, sequence) => ({
      owner_id: scope.ownerId,
      artist_id: scope.artistId,
      campaign_id: null,
      source_event_id: null,
      job_type: task.jobType,
      payload: {},
      status: "queued" as const,
      requires_approval: false,
      approval_status: "not_required" as const,
      run_after: new Date(now + sequence * 1_000).toISOString(),
      attempt_count: 0,
      max_attempts: 5,
      idempotency_key: `maintenance:${scope.artistId}:${task.jobType}:v1`,
    })),
  );

  let seeded = 0;
  let existing = 0;
  for (let offset = 0; offset < rows.length; offset += SEED_CONCURRENCY) {
    const batch = rows.slice(offset, offset + SEED_CONCURRENCY);
    const outcomes = await Promise.all(batch.map(async (row) => {
      const { error } = await client.from("automation_jobs").insert(row);
      if (!error) return "seeded" as const;
      if (duplicateError(error.message)) return "existing" as const;
      throw new Error(error.message);
    }));
    for (const outcome of outcomes) {
      if (outcome === "seeded") seeded += 1;
      else existing += 1;
    }
  }
  return { scopes: scopes.length, seeded, existing };
}

export async function runDurableMarketingHeartbeat(input: {
  budgetMs?: number;
  maxMaintenanceJobs?: number;
} = {}) {
  const startedAt = Date.now();
  const budgetMs = Math.max(15_000, Math.min(input.budgetMs ?? DEFAULT_HEARTBEAT_BUDGET_MS, 180_000));
  const deadline = startedAt + budgetMs;

  const musicIngestion = await runStep("music ingestion follow-up", () =>
    recoverStrandedMusicIngestionFollowUp({ client: createServiceClient() }));
  const sharedWorker = await runStep("shared worker recovery", () => runSharedWorkerRecovery());
  const maintenanceSeed = await runStep("maintenance seed", () => seedMarketingMaintenanceJobs());

  const maintenance = Date.now() < deadline
    ? await runStep("durable maintenance", () => runDueAutomationJobsWithinBudget({
        deadline,
        maxJobs: input.maxMaintenanceJobs ?? 8,
      }))
    : {
        ok: true as const,
        value: {
          claimed: 0,
          completed: 0,
          failed: 0,
          rescheduled: 0,
          budgetExhausted: true,
        },
      };

  const results = { musicIngestion, sharedWorker, maintenanceSeed, maintenance };
  const failures = Object.entries(results)
    .filter(([, result]) => !result.ok)
    .map(([name, result]) => ({
      name,
      error: "error" in result ? result.error : "Unknown heartbeat failure.",
    }));

  return {
    ok: failures.length === 0,
    partial: failures.length > 0,
    mode: "durable-bounded-heartbeat" as const,
    elapsedMs: Date.now() - startedAt,
    budgetMs,
    failures,
    ...results,
  };
}
