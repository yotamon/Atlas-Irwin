import "server-only";

import { createMarketingServiceClient } from "@/lib/marketing/db";
import { learnedRouteForTask } from "./learning";
import { atlasAiTaskRegistry } from "./tasks";
import { getAiBudgetSnapshot, loadAiControlSettings } from "./control-plane";

function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function runCost(run: { actual_cost_usd: number | null; estimated_cost_usd: number | null }) {
  return Number(run.actual_cost_usd ?? run.estimated_cost_usd ?? 0);
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function getAiControlSummary(ownerId: string) {
  const client = createMarketingServiceClient();
  const settings = await loadAiControlSettings(ownerId);
  const budget = await getAiBudgetSnapshot(ownerId, settings);
  const start = monthStartIso();
  const [runsResult, feedbackResult] = await Promise.all([
    client.from("generation_runs").select("*").eq("owner_id", ownerId).gte("created_at", start).order("created_at", { ascending: false }),
    client.from("ai_feedback_events").select("*").eq("owner_id", ownerId).gte("created_at", start).order("created_at", { ascending: false }),
  ]);
  if (runsResult.error) throw new Error(runsResult.error.message);
  if (feedbackResult.error) throw new Error(feedbackResult.error.message);

  const runs = runsResult.data ?? [];
  const feedback = feedbackResult.data ?? [];
  const completed = runs.filter((run) => run.status === "completed");
  const failed = runs.filter((run) => run.status === "failed");
  const roots = runs.filter((run) => run.attempt_index === 0);
  const qualityMeasured = completed.filter((run) => run.quality_gate_passed !== null);
  const firstPassMeasured = roots.filter((run) => run.status === "completed" && run.quality_gate_passed !== null);
  const humanFeedback = feedback.filter((event) => event.event_type !== "performance");

  const feedbackByRun = new Map<string, number[]>();
  for (const event of feedback) {
    if (event.quality_signal === null) continue;
    const values = feedbackByRun.get(event.generation_run_id) ?? [];
    values.push(Number(event.quality_signal));
    feedbackByRun.set(event.generation_run_id, values);
  }

  const taskMap = new Map<string, {
    task: string;
    requests: number;
    costUsd: number;
    completed: number;
    failed: number;
    escalations: number;
    qualityScores: number[];
    feedbackScores: number[];
  }>();
  for (const run of runs) {
    const task = run.task_type || run.purpose || "unknown";
    const row = taskMap.get(task) ?? { task, requests: 0, costUsd: 0, completed: 0, failed: 0, escalations: 0, qualityScores: [], feedbackScores: [] };
    row.requests += 1;
    row.costUsd += runCost(run);
    if (run.status === "completed") row.completed += 1;
    if (run.status === "failed") row.failed += 1;
    if (run.parent_run_id || run.escalated) row.escalations += 1;
    if (run.quality_score !== null) row.qualityScores.push(Number(run.quality_score));
    row.feedbackScores.push(...(feedbackByRun.get(run.id) ?? []));
    taskMap.set(task, row);
  }

  const modelMap = new Map<string, { model: string; requests: number; costUsd: number; failures: number }>();
  for (const run of runs) {
    const model = run.model || run.requested_model || "unknown";
    const row = modelMap.get(model) ?? { model, requests: 0, costUsd: 0, failures: 0 };
    row.requests += 1;
    row.costUsd += runCost(run);
    if (run.status === "failed") row.failures += 1;
    modelMap.set(model, row);
  }

  const feedbackCounts = {
    accepted: humanFeedback.filter((event) => event.event_type === "accepted").length,
    edited: humanFeedback.filter((event) => event.event_type === "edited").length,
    rejected: humanFeedback.filter((event) => event.event_type === "rejected").length,
    regenerated: humanFeedback.filter((event) => event.event_type === "regenerated").length,
    published: humanFeedback.filter((event) => event.event_type === "published").length,
    performance: feedback.filter((event) => event.event_type === "performance").length,
  };

  const registry = atlasAiTaskRegistry(settings);
  const learning = await Promise.all(registry.map(async (policy) => {
    const decision = await learnedRouteForTask({ ownerId, settings, policy }).catch(() => ({
      applied: false,
      reason: "Adaptive evidence is temporarily unavailable; using the configured route.",
      route: policy.models,
      evidence: [],
    }));
    return {
      task: policy.task,
      label: policy.label,
      configuredRoute: policy.models,
      ...decision,
    };
  }));

  return {
    settings,
    budget,
    stats: {
      requests: runs.length,
      completed: completed.length,
      failed: failed.length,
      successRate: completed.length + failed.length ? completed.length / (completed.length + failed.length) : null,
      qualityPassRate: qualityMeasured.length ? qualityMeasured.filter((run) => run.quality_gate_passed).length / qualityMeasured.length : null,
      firstPassSuccessRate: firstPassMeasured.length ? firstPassMeasured.filter((run) => run.quality_gate_passed).length / firstPassMeasured.length : null,
      semanticEscalations: roots.filter((run) => run.escalated).length,
      technicalFallbacks: runs.filter((run) => run.fallback_used).length,
      adaptiveRoutes: learning.filter((decision) => decision.applied).length,
      totalInputTokens: runs.reduce((sum, run) => sum + Number(run.input_tokens ?? 0), 0),
      totalOutputTokens: runs.reduce((sum, run) => sum + Number(run.output_tokens ?? 0), 0),
      averageLatencyMs: average(completed.flatMap((run) => run.latency_ms === null ? [] : [Number(run.latency_ms)])),
      humanQualityScore: average(humanFeedback.flatMap((event) => event.quality_signal === null ? [] : [Number(event.quality_signal)])),
      feedbackCounts,
    },
    tasks: [...taskMap.values()].map((row) => ({
      task: row.task,
      requests: row.requests,
      costUsd: Number(row.costUsd.toFixed(6)),
      successRate: row.completed + row.failed ? row.completed / (row.completed + row.failed) : null,
      escalations: row.escalations,
      averageQuality: average(row.qualityScores),
      humanQuality: average(row.feedbackScores),
    })).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests),
    models: [...modelMap.values()].map((row) => ({ ...row, costUsd: Number(row.costUsd.toFixed(6)) })).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests),
    recentRuns: runs.slice(0, 30),
    registry,
    learning,
  };
}
