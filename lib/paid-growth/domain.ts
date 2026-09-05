import type { Json } from "@/types/database";
import type { PaidGrowthExperiment, PaidGrowthObservation, PaidGrowthSuccessMetric } from "@/types/paid-growth-database";

export type PaidGrowthEvaluation = {
  phase: "awaiting_sample" | "promising" | "underperforming" | "success" | "stop" | "inconclusive";
  label: string;
  detail: string;
  sample: number;
  metricValue: number | null;
  metricLabel: string;
  shouldStop: boolean;
  learningEligible: boolean;
  verified: boolean;
};

type StopConditions = {
  maxSpendWithoutResultCents?: number;
  maxCostPerResultCents?: number;
  stopAtBudgetCeiling?: boolean;
};

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stopConditions(value: Json): StopConditions {
  const raw = object(value);
  const number = (key: string) => {
    const parsed = Number(raw[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  return {
    maxSpendWithoutResultCents: number("maxSpendWithoutResultCents"),
    maxCostPerResultCents: number("maxCostPerResultCents"),
    stopAtBudgetCeiling: raw.stopAtBudgetCeiling !== false,
  };
}

function latest(observations: PaidGrowthObservation[]) {
  return [...observations].sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at))[0] ?? null;
}

function metricValue(metric: PaidGrowthSuccessMetric, row: PaidGrowthObservation | null) {
  if (!row) return null;
  switch (metric) {
    case "landing_views": return row.landing_views;
    case "outbound_clicks": return row.outbound_clicks;
    case "pre_save_completions": return row.pre_save_completions;
    case "cost_per_outbound_click": return row.outbound_clicks > 0 ? row.spend_cents / row.outbound_clicks : null;
    case "cost_per_pre_save_completion": return row.pre_save_completions > 0 ? row.spend_cents / row.pre_save_completions : null;
  }
}

function success(metric: PaidGrowthSuccessMetric, actual: number | null, threshold: number) {
  if (actual == null) return false;
  return metric.startsWith("cost_per_") ? actual <= threshold : actual >= threshold;
}

function resultCount(metric: PaidGrowthSuccessMetric, row: PaidGrowthObservation | null) {
  if (!row) return 0;
  if (metric.includes("pre_save")) return row.pre_save_completions;
  if (metric.includes("outbound_click")) return row.outbound_clicks;
  return row.landing_views;
}

export function paidGrowthMetricLabel(metric: PaidGrowthSuccessMetric) {
  const labels: Record<PaidGrowthSuccessMetric, string> = {
    landing_views: "Landing views",
    outbound_clicks: "Outbound clicks",
    pre_save_completions: "Verified pre-saves",
    cost_per_outbound_click: "Cost per outbound click",
    cost_per_pre_save_completion: "Cost per verified pre-save",
  };
  return labels[metric];
}

export function evaluatePaidGrowthExperiment(experiment: PaidGrowthExperiment, observations: PaidGrowthObservation[]): PaidGrowthEvaluation {
  const row = latest(observations);
  const sample = row?.impressions ?? 0;
  const actual = metricValue(experiment.success_metric, row);
  const conditions = stopConditions(experiment.stop_conditions);
  const verified = Boolean(row?.verified);
  const enoughSample = sample >= experiment.minimum_sample;
  const thresholdMet = success(experiment.success_metric, actual, Number(experiment.success_threshold));
  const results = resultCount(experiment.success_metric, row);
  const atCeiling = (row?.spend_cents ?? experiment.spent_cents) >= experiment.budget_ceiling_cents;
  const stopForNoResult = Boolean(conditions.maxSpendWithoutResultCents != null && (row?.spend_cents ?? 0) >= conditions.maxSpendWithoutResultCents && results === 0);
  const costPerResult = results > 0 ? (row?.spend_cents ?? 0) / results : null;
  const stopForCost = Boolean(conditions.maxCostPerResultCents != null && costPerResult != null && costPerResult > conditions.maxCostPerResultCents && enoughSample);
  const stopAtCeiling = Boolean(conditions.stopAtBudgetCeiling !== false && atCeiling && !thresholdMet);
  const shouldStop = stopForNoResult || stopForCost || stopAtCeiling;
  const metricLabel = paidGrowthMetricLabel(experiment.success_metric);

  if (!row || !enoughSample) {
    return {
      phase: shouldStop ? "stop" : "awaiting_sample",
      label: shouldStop ? "Stop condition reached" : "Gathering evidence",
      detail: shouldStop ? "A configured safety condition was reached before the experiment had enough evidence." : `${sample.toLocaleString()} of ${experiment.minimum_sample.toLocaleString()} required impressions observed.`,
      sample,
      metricValue: actual,
      metricLabel,
      shouldStop,
      learningEligible: false,
      verified,
    };
  }

  if (thresholdMet) {
    return {
      phase: "success",
      label: "Success threshold reached",
      detail: `${metricLabel} reached the artist-approved success condition after the minimum sample.`,
      sample,
      metricValue: actual,
      metricLabel,
      shouldStop: false,
      learningEligible: verified,
      verified,
    };
  }

  if (shouldStop) {
    return {
      phase: "stop",
      label: "Stop condition reached",
      detail: stopForNoResult ? "Spend reached the no-result stop loss." : stopForCost ? "Cost per result crossed the configured stop loss." : "The hard budget ceiling was reached without meeting the success threshold.",
      sample,
      metricValue: actual,
      metricLabel,
      shouldStop: true,
      learningEligible: verified,
      verified,
    };
  }

  if (atCeiling) {
    return {
      phase: "inconclusive",
      label: "Budget exhausted",
      detail: "The experiment has enough sample, but the approved budget ended without reaching the success threshold.",
      sample,
      metricValue: actual,
      metricLabel,
      shouldStop: true,
      learningEligible: verified,
      verified,
    };
  }

  return {
    phase: "underperforming",
    label: "Below success threshold",
    detail: "The minimum sample is available, but the approved success condition has not been reached yet.",
    sample,
    metricValue: actual,
    metricLabel,
    shouldStop: false,
    learningEligible: false,
    verified,
  };
}

export function paidGrowthEvidenceStrength(evidence: Json): PaidGrowthExperiment["evidence_strength"] {
  if (!Array.isArray(evidence)) return "preliminary";
  const trusted = evidence.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).verified === true).length;
  if (trusted >= 2) return "strong";
  if (trusted === 1 || evidence.length >= 2) return "supported";
  return "preliminary";
}
