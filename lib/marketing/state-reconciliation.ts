import "server-only";

import { createMarketingServiceClient } from "./db";
import {
  ensureLifecycleCampaignExecution,
  ensureReadyContentPublicationApprovals,
} from "./lifecycle-execution";
import type { Json } from "@/types/database";

function asJson(value: unknown) {
  return value as Json;
}

function objectValue(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export async function reconcileCampaignPhaseStates(now = new Date()) {
  const marketing = createMarketingServiceClient();
  const { data: phases, error } = await marketing.from("campaign_phases")
    .select("id,campaign_id,status,starts_at,ends_at")
    .in("status", ["planned", "active"])
    .order("starts_at", { ascending: true, nullsFirst: true })
    .limit(250);
  if (error) throw new Error(error.message);
  if (!phases?.length) return { considered: 0, changed: 0, active: 0, skipped: 0, completed: 0 };

  const phaseIds = phases.map((phase) => phase.id);
  const { data: content, error: contentError } = await marketing.from("content_items")
    .select("phase_id,status")
    .in("phase_id", phaseIds)
    .not("status", "eq", "Archived");
  if (contentError) throw new Error(contentError.message);
  const publishedByPhase = new Set(
    (content ?? []).filter((item) => item.status === "Published" && item.phase_id).map((item) => item.phase_id!),
  );

  let changed = 0;
  let active = 0;
  let skipped = 0;
  let completed = 0;
  for (const phase of phases) {
    if (!phase.starts_at || !phase.ends_at) continue;
    const startsAt = new Date(phase.starts_at).getTime();
    const endsAt = new Date(phase.ends_at).getTime();
    const timestamp = now.getTime();
    const nextStatus = timestamp >= startsAt && timestamp < endsAt
      ? "active"
      : timestamp >= endsAt
        ? publishedByPhase.has(phase.id) ? "completed" : "skipped"
        : "planned";
    if (nextStatus === "active") active += 1;
    if (nextStatus === "skipped") skipped += 1;
    if (nextStatus === "completed") completed += 1;
    if (phase.status === nextStatus) continue;
    const { error: updateError } = await marketing.from("campaign_phases")
      .update({ status: nextStatus })
      .eq("id", phase.id);
    if (updateError) throw new Error(updateError.message);
    changed += 1;
  }
  return { considered: phases.length, changed, active, skipped, completed };
}

function contentAssetId(purpose: string) {
  const match = purpose.match(/^content_asset:([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
  return match?.[1] ?? null;
}

export async function reconcileOrphanedGenerationRuns() {
  const marketing = createMarketingServiceClient();
  const { data: runs, error } = await marketing.from("generation_runs")
    .select("id,purpose,status,provider_request_id,metadata")
    .in("status", ["queued", "running"])
    .like("purpose", "content_asset:%")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);

  const parsed = (runs ?? []).map((run) => ({ run, contentItemId: contentAssetId(run.purpose) })).filter((entry) => entry.contentItemId);
  const ids = [...new Set(parsed.map((entry) => entry.contentItemId!))];
  const { data: existing, error: existingError } = ids.length
    ? await marketing.from("content_items").select("id").in("id", ids)
    : { data: [], error: null };
  if (existingError) throw new Error(existingError.message);
  const existingIds = new Set((existing ?? []).map((item) => item.id));

  let failed = 0;
  let ambiguous = 0;
  for (const { run, contentItemId } of parsed) {
    if (!contentItemId || existingIds.has(contentItemId)) continue;
    if (run.status === "running" && run.provider_request_id) {
      ambiguous += 1;
      continue;
    }
    const metadata = objectValue(run.metadata);
    const { error: updateError } = await marketing.from("generation_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error: "Lifecycle reconciliation stopped this run because its source content item no longer exists. No retry was submitted.",
      metadata: asJson({
        ...metadata,
        reconciledOrphan: true,
        orphanedContentItemId: contentItemId,
        reconciliationPolicy: "fail_only_when_no_ambiguous_provider_submission",
      }),
    }).eq("id", run.id);
    if (updateError) throw new Error(updateError.message);
    failed += 1;
  }
  return { considered: parsed.length, failed, ambiguous };
}

export async function ensureCampaignProductionQueues(limit = 12) {
  const marketing = createMarketingServiceClient();
  const { data: campaigns, error } = await marketing.from("campaigns")
    .select("id")
    .in("status", ["draft", "planned", "active"])
    .order("updated_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(error.message);

  const outcomes: Array<{ campaignId: string; outcome: string; error?: string }> = [];
  for (const campaign of campaigns ?? []) {
    try {
      const result = await ensureLifecycleCampaignExecution(campaign.id);
      outcomes.push({ campaignId: campaign.id, outcome: result.outcome });
    } catch (error) {
      outcomes.push({
        campaignId: campaign.id,
        outcome: "failed",
        error: error instanceof Error ? error.message : "Campaign execution repair failed.",
      });
    }
  }
  return {
    considered: campaigns?.length ?? 0,
    created: outcomes.filter((item) => item.outcome === "queue_created").length,
    blocked: outcomes.filter((item) => item.outcome === "blocked").length,
    failed: outcomes.filter((item) => item.outcome === "failed").length,
    outcomes,
  };
}

export async function reconcileMarketingState() {
  const phases = await reconcileCampaignPhaseStates();
  const orphanedGeneration = await reconcileOrphanedGenerationRuns();
  const campaignQueues = await ensureCampaignProductionQueues();
  const publicationApprovals = await ensureReadyContentPublicationApprovals();
  return { phases, orphanedGeneration, campaignQueues, publicationApprovals };
}
