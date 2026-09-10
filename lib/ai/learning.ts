import "server-only";

import { createMarketingServiceClient } from "@/lib/marketing/db";
import type { AiControlSettings } from "@/types/marketing-database";
import type { AtlasAiTaskPolicy } from "./tasks";

const LOOKBACK_DAYS = 90;
const MIN_COMPLETED_SAMPLES = 6;
const MIN_HUMAN_SAMPLES = 3;
const MIN_HUMAN_QUALITY = 0.72;
const MIN_GATE_QUALITY = 0.9;

function lookbackIso() {
  return new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type LearnedModelEvidence = {
  model: string;
  completedSamples: number;
  humanSamples: number;
  averageCostUsd: number | null;
  gateQuality: number | null;
  humanQuality: number | null;
  eligible: boolean;
};

export type LearnedRouteDecision = {
  applied: boolean;
  reason: string;
  route: string[];
  evidence: LearnedModelEvidence[];
};

export async function learnedRouteForTask({
  ownerId,
  settings,
  policy,
}: {
  ownerId: string;
  settings: AiControlSettings;
  policy: AtlasAiTaskPolicy;
}): Promise<LearnedRouteDecision> {
  if (settings.routing_mode !== "auto") {
    return { applied: false, reason: `Routing is forced to ${settings.routing_mode}.`, route: policy.models, evidence: [] };
  }
  if (policy.models.length < 2) {
    return { applied: false, reason: "The task has a single approved primary route.", route: policy.models, evidence: [] };
  }

  const client = createMarketingServiceClient();
  const { data: runs, error: runsError } = await client.from("generation_runs")
    .select("id,model,status,quality_score,actual_cost_usd,estimated_cost_usd")
    .eq("owner_id", ownerId)
    .eq("provider", "vercel-gateway")
    .eq("task_type", policy.task)
    .gte("created_at", lookbackIso())
    .in("model", policy.models)
    .order("created_at", { ascending: false })
    .limit(500);
  if (runsError) throw new Error(runsError.message);
  const completedRuns = (runs ?? []).filter((run) => run.status === "completed");
  if (!completedRuns.length) {
    return { applied: false, reason: "Gathering evidence: no completed samples yet.", route: policy.models, evidence: [] };
  }

  const runIds = completedRuns.map((run) => run.id);
  const { data: feedback, error: feedbackError } = await client.from("ai_feedback_events")
    .select("generation_run_id,event_type,quality_signal")
    .eq("owner_id", ownerId)
    .in("generation_run_id", runIds)
    .neq("event_type", "performance");
  if (feedbackError) throw new Error(feedbackError.message);

  const qualityByRun = new Map<string, number[]>();
  for (const event of feedback ?? []) {
    if (event.quality_signal === null) continue;
    const scores = qualityByRun.get(event.generation_run_id) ?? [];
    scores.push(Number(event.quality_signal));
    qualityByRun.set(event.generation_run_id, scores);
  }

  const evidence = policy.models.map((model): LearnedModelEvidence => {
    const modelRuns = completedRuns.filter((run) => run.model === model);
    const costs = modelRuns.flatMap((run) => {
      const value = run.actual_cost_usd ?? run.estimated_cost_usd;
      return value === null ? [] : [Number(value)];
    });
    const gates = modelRuns.flatMap((run) => run.quality_score === null ? [] : [Number(run.quality_score)]);
    const humanScores = modelRuns.flatMap((run) => qualityByRun.get(run.id) ?? []);
    const gateQuality = mean(gates);
    const humanQuality = mean(humanScores);
    const eligible = modelRuns.length >= MIN_COMPLETED_SAMPLES
      && humanScores.length >= MIN_HUMAN_SAMPLES
      && (gateQuality ?? 0) >= Math.min(MIN_GATE_QUALITY, policy.qualityThreshold)
      && (humanQuality ?? 0) >= MIN_HUMAN_QUALITY;
    return {
      model,
      completedSamples: modelRuns.length,
      humanSamples: humanScores.length,
      averageCostUsd: mean(costs),
      gateQuality,
      humanQuality,
      eligible,
    };
  });

  const eligible = evidence.filter((item) => item.eligible).sort((a, b) => {
    const aCost = a.averageCostUsd ?? Number.POSITIVE_INFINITY;
    const bCost = b.averageCostUsd ?? Number.POSITIVE_INFINITY;
    if (aCost !== bCost) return aCost - bCost;
    return (b.humanQuality ?? 0) - (a.humanQuality ?? 0);
  });
  if (!eligible.length) {
    const maxCompleted = Math.max(...evidence.map((item) => item.completedSamples), 0);
    const maxHuman = Math.max(...evidence.map((item) => item.humanSamples), 0);
    return {
      applied: false,
      reason: `Gathering evidence: best candidate has ${maxCompleted}/${MIN_COMPLETED_SAMPLES} completed and ${maxHuman}/${MIN_HUMAN_SAMPLES} human-rated samples.`,
      route: policy.models,
      evidence,
    };
  }

  const learnedOrder = eligible.map((item) => item.model);
  const remaining = policy.models.filter((model) => !learnedOrder.includes(model));
  const route = [...learnedOrder, ...remaining];
  const applied = route.some((model, index) => model !== policy.models[index]);
  const winner = eligible[0];
  return {
    applied,
    reason: applied
      ? `${winner.model} has enough recent evidence and the best observed cost among quality-qualified models.`
      : `${winner.model} already leads the configured route and is supported by recent quality evidence.`,
    route,
    evidence,
  };
}

export const AI_LEARNING_THRESHOLDS = {
  lookbackDays: LOOKBACK_DAYS,
  minCompletedSamples: MIN_COMPLETED_SAMPLES,
  minHumanSamples: MIN_HUMAN_SAMPLES,
  minHumanQuality: MIN_HUMAN_QUALITY,
  minGateQuality: MIN_GATE_QUALITY,
} as const;
