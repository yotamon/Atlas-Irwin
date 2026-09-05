import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { PaidGrowthExperiment, PaidGrowthObservation } from "@/types/paid-growth-database";
import { asPaidGrowthClient } from "./db";
import { evaluatePaidGrowthExperiment, paidGrowthMetricLabel, type PaidGrowthEvaluation } from "./domain";
import { getPaidGrowthProvider } from "./provider";

export type PaidGrowthArtistCard = {
  experiment: PaidGrowthExperiment;
  releaseTitle: string;
  momentLabel: string | null;
  creativeTitle: string | null;
  creativeAssetUrl: string | null;
  sourceCode: string | null;
  evaluation: PaidGrowthEvaluation;
  providerConfigured: boolean;
  providerMessage: string | null;
  spendLabel: string;
  successLabel: string;
};

export type PaidGrowthNeedsYouDecision = {
  key: string;
  title: string;
  detail: string;
  severity: "required" | "decision" | "review";
  href: string;
};

function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
}

function evidenceArray(value: Json) {
  return Array.isArray(value) ? value : [];
}

export async function loadPaidGrowthWorkspace(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
}) {
  const db = asPaidGrowthClient(input.db);
  const [experimentsResult, observationsResult, releasesResult, momentsResult, contentResult, sourcesResult] = await Promise.all([
    db.from("paid_growth_experiments").select("*").eq("owner_id", input.ownerId).eq("artist_id", input.artistId).order("updated_at", { ascending: false }),
    db.from("paid_growth_observations").select("*").eq("owner_id", input.ownerId).eq("artist_id", input.artistId).order("observed_at", { ascending: false }),
    db.from("releases").select("id,title").eq("owner_id", input.ownerId).eq("artist_id", input.artistId),
    db.from("moments").select("id,label").eq("owner_id", input.ownerId).eq("artist_id", input.artistId),
    db.from("content_items").select("id,title,asset_url").eq("owner_id", input.ownerId).eq("artist_id", input.artistId),
    db.from("smart_link_sources").select("id,code").eq("owner_id", input.ownerId).eq("artist_id", input.artistId),
  ]);
  const firstError = [experimentsResult, observationsResult, releasesResult, momentsResult, contentResult, sourcesResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const observations = observationsResult.data ?? [];
  const releaseById = new Map((releasesResult.data ?? []).map((row) => [row.id, row.title]));
  const momentById = new Map((momentsResult.data ?? []).map((row) => [row.id, row.label]));
  const creativeById = new Map((contentResult.data ?? []).map((row) => [row.id, row]));
  const sourceById = new Map((sourcesResult.data ?? []).map((row) => [row.id, row.code]));
  const cards: PaidGrowthArtistCard[] = (experimentsResult.data ?? []).map((experiment) => {
    const experimentObservations = observations.filter((row) => row.experiment_id === experiment.id) as PaidGrowthObservation[];
    const evaluation = evaluatePaidGrowthExperiment(experiment as PaidGrowthExperiment, experimentObservations);
    const provider = getPaidGrowthProvider(experiment.provider);
    const creative = experiment.content_item_id ? creativeById.get(experiment.content_item_id) : null;
    const threshold = Number(experiment.success_threshold);
    const thresholdText = experiment.success_metric.startsWith("cost_per_")
      ? `${paidGrowthMetricLabel(experiment.success_metric)} ≤ ${money(Math.round(threshold), experiment.currency)}`
      : `${paidGrowthMetricLabel(experiment.success_metric)} ≥ ${threshold.toLocaleString()}`;
    return {
      experiment: experiment as PaidGrowthExperiment,
      releaseTitle: releaseById.get(experiment.release_id) ?? "Release",
      momentLabel: experiment.moment_id ? momentById.get(experiment.moment_id) ?? null : null,
      creativeTitle: creative?.title ?? null,
      creativeAssetUrl: creative?.asset_url ?? null,
      sourceCode: experiment.smart_link_source_id ? sourceById.get(experiment.smart_link_source_id) ?? null : null,
      evaluation,
      providerConfigured: provider.configured,
      providerMessage: provider.reasonUnavailable,
      spendLabel: `${money(experiment.spent_cents, experiment.currency)} of ${money(experiment.budget_ceiling_cents, experiment.currency)}`,
      successLabel: thresholdText,
    };
  });

  return {
    cards,
    totalApprovedSpendCents: cards.filter((card) => ["approved", "launching", "running", "paused", "evaluating"].includes(card.experiment.state)).reduce((sum, card) => sum + card.experiment.spent_cents, 0),
    activeCount: cards.filter((card) => ["approved", "launching", "running", "paused", "evaluating"].includes(card.experiment.state)).length,
    verifiedLearningCount: cards.filter((card) => card.evaluation.learningEligible).length,
  };
}

export function paidGrowthNeedsYou(cards: PaidGrowthArtistCard[]): PaidGrowthNeedsYouDecision[] {
  const decisions: PaidGrowthNeedsYouDecision[] = [];
  for (const card of cards) {
    const experiment = card.experiment;
    if (experiment.state === "ready_for_approval" && experiment.approval_status === "pending") {
      decisions.push({
        key: `approve:${experiment.id}`,
        title: `Approve paid test: ${experiment.title}`,
        detail: `${card.releaseTitle} · hard ceiling ${money(experiment.budget_ceiling_cents, experiment.currency)} · ${card.successLabel}.`,
        severity: "decision",
        href: `/studio/growth/paid?experiment=${experiment.id}`,
      });
    } else if (["running", "evaluating"].includes(experiment.state) && card.evaluation.shouldStop) {
      decisions.push({
        key: `stop:${experiment.id}`,
        title: `Paid test reached its stop condition: ${experiment.title}`,
        detail: card.evaluation.detail,
        severity: "required",
        href: `/studio/growth/paid?experiment=${experiment.id}`,
      });
    } else if (experiment.state === "approved" && !card.providerConfigured) {
      decisions.push({
        key: `provider:${experiment.id}`,
        title: `Paid test is approved but not launched: ${experiment.title}`,
        detail: card.providerMessage ?? "A paid-media provider connection is required for external launch.",
        severity: "review",
        href: `/studio/growth/paid?experiment=${experiment.id}`,
      });
    }
  }
  return decisions;
}

export function paidGrowthEvidenceSummary(experiment: PaidGrowthExperiment) {
  const evidence = evidenceArray(experiment.evidence);
  if (!evidence.length) return "Preliminary evidence";
  if (experiment.evidence_strength === "strong") return "Multiple verified signals support this test";
  if (experiment.evidence_strength === "supported") return "More than one signal supports this test";
  return "One preliminary signal supports this test";
}
