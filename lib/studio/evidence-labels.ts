import type { MomentSourceMode } from "@/types/moments-database";

type MomentEvidenceInput = {
  source_mode: MomentSourceMode;
  hook_score: number | null;
  energy_score: number | null;
  emotional_score: number | null;
  vocal_score: number | null;
  uniqueness_score: number | null;
};

function strong(value: number | null | undefined, threshold = 0.72) {
  return typeof value === "number" && Number.isFinite(value) && value >= threshold;
}

export function evidenceStrengthLabel(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Preliminary evidence";
  if (value >= 0.82) return "Strong evidence";
  if (value >= 0.64) return "Supported by evidence";
  return "Preliminary evidence";
}

export function analysisConfidenceLabel(value: number) {
  if (value >= 0.82) return "High-confidence analysis";
  if (value >= 0.64) return "Good evidence coverage";
  return "Preliminary analysis";
}

export function hookRecommendationLabel(score: number, rank: number) {
  if (rank === 0) return "Best fit";
  if (score >= 0.72) return "Strong fit";
  return "Alternative";
}

export function momentEvidenceReasons(moment: MomentEvidenceInput) {
  const reasons: string[] = [];

  if (moment.source_mode === "fused") reasons.push("Multiple signals agree");
  else if (moment.source_mode === "lyrics") reasons.push("Lyric timing supports it");
  else if (moment.source_mode === "stems") reasons.push("Stem activity supports it");
  else reasons.push("Track structure supports it");

  if (strong(moment.hook_score)) reasons.push("Strong hook signal");
  if (strong(moment.vocal_score)) reasons.push("Strong vocal signal");
  if (strong(moment.energy_score, 0.78)) reasons.push("Energy lift");
  if (strong(moment.emotional_score)) reasons.push("Emotional payoff");
  if (strong(moment.uniqueness_score)) reasons.push("Distinctive section");

  return reasons.slice(0, 3);
}

export function momentEvidenceSummary(moment: MomentEvidenceInput) {
  return momentEvidenceReasons(moment).join(" · ");
}