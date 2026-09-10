import "server-only";

import { createMarketingServiceClient } from "@/lib/marketing/db";
import type { Json } from "@/types/database";
import type { AiFeedbackEventType, AiUserOutcome } from "@/types/marketing-database";
import type { AtlasAiTaskType } from "./tasks";

function asJson(value: unknown) {
  return value as Json;
}

function clamp01(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function defaultQualitySignal(eventType: AiFeedbackEventType, editRatio?: number | null) {
  if (eventType === "accepted" || eventType === "published") return 1;
  if (eventType === "rejected") return 0;
  if (eventType === "regenerated") return 0.1;
  if (eventType === "edited") return 1 - (clamp01(editRatio) ?? 0.5);
  return null;
}

function outcomeFromEvent(eventType: AiFeedbackEventType): AiUserOutcome | null {
  if (eventType === "performance") return null;
  return eventType;
}

export function approximateEditRatio(before: string, after: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const left = normalize(before);
  const right = normalize(after);
  if (left === right) return 0;
  if (!left || !right) return 1;

  const a = left.split(" ").slice(0, 2500);
  const b = right.split(" ").slice(0, 2500);
  const max = Math.max(a.length, b.length);
  let samePosition = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] === b[index]) samePosition += 1;
  }
  return Math.max(0, Math.min(1, (max - samePosition) / max));
}

export async function recordAiFeedback({
  ownerId,
  generationRunId,
  eventType,
  entityType,
  entityId,
  editDistanceRatio,
  qualitySignal,
  metadata,
}: {
  ownerId: string;
  generationRunId: string;
  eventType: AiFeedbackEventType;
  entityType?: string | null;
  entityId?: string | null;
  editDistanceRatio?: number | null;
  qualitySignal?: number | null;
  metadata?: unknown;
}) {
  const client = createMarketingServiceClient();
  const editRatio = clamp01(editDistanceRatio);
  const signal = clamp01(qualitySignal ?? defaultQualitySignal(eventType, editRatio));
  const { error } = await client.from("ai_feedback_events").insert({
    owner_id: ownerId,
    generation_run_id: generationRunId,
    event_type: eventType,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    edit_distance_ratio: editRatio,
    quality_signal: signal,
    metadata: asJson(metadata ?? {}),
  });
  if (error) throw new Error(error.message);

  const outcome = outcomeFromEvent(eventType);
  if (outcome) {
    const { error: updateError } = await client.from("generation_runs").update({
      user_outcome: outcome,
      edit_distance_ratio: editRatio,
      outcome_recorded_at: new Date().toISOString(),
    }).eq("id", generationRunId).eq("owner_id", ownerId);
    if (updateError) throw new Error(updateError.message);
  }
}

export async function latestAiRunId({
  ownerId,
  task,
  campaignId,
  videoProjectId,
}: {
  ownerId: string;
  task: AtlasAiTaskType;
  campaignId?: string | null;
  videoProjectId?: string | null;
}) {
  const client = createMarketingServiceClient();
  let query = client.from("generation_runs")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("task_type", task)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (videoProjectId) query = query.eq("video_project_id", videoProjectId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ?? null;
}

export async function recordLatestTaskFeedback(input: {
  ownerId: string;
  task: AtlasAiTaskType;
  campaignId?: string | null;
  videoProjectId?: string | null;
  eventType: AiFeedbackEventType;
  entityType?: string | null;
  entityId?: string | null;
  editDistanceRatio?: number | null;
  qualitySignal?: number | null;
  metadata?: unknown;
}) {
  const runId = await latestAiRunId(input);
  if (!runId) return false;
  await recordAiFeedback({ ...input, generationRunId: runId });
  return true;
}
