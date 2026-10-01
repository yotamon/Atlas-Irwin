import type { Json } from "@/types/database";

export type MasteringPreferenceDecision = "approved" | "kept_original";

export type MasteringPreferenceEvidence = {
  jobId: string;
  preset: "streaming_safe" | "balanced" | "punchy" | "dynamic";
  decision: MasteringPreferenceDecision;
  decidedAt: string | null;
  integratedLufs: number | null;
  plrLossLu: number | null;
  limiterGainReductionDb: number | null;
  totalEqEnergy: number | null;
  stereoChanged: boolean;
};

export type MasteringPreferenceProfile = {
  schema: "ensemblis.mastering_preferences.v1";
  evidenceCount: number;
  approvedCount: number;
  keptOriginalCount: number;
  latestDecisionAt: string | null;
  preferredCreativeLufs: number | null;
  preferredLimiterGainReductionDb: number | null;
  preferredEqEnergy: number | null;
  presetApprovals: Record<"balanced" | "punchy" | "dynamic", number>;
  sourcePreservingApprovals: number;
  confidence: number;
  boundedInfluence: {
    maxLoudnessNudgeLu: number;
    mayTightenDamageBudget: boolean;
    mayLoosenTechnicalSafety: false;
  };
};

type MasteringJobLike = {
  id: string;
  preset: string;
  result_payload: Json | unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function masteringPreferenceEvidence(job: MasteringJobLike): MasteringPreferenceEvidence | null {
  const result = record(job.result_payload);
  const artistDecision = record(result.artist_decision);
  const decision = artistDecision.decision;
  if (decision !== "approved" && decision !== "kept_original") return null;
  if (!["streaming_safe", "balanced", "punchy", "dynamic"].includes(job.preset)) return null;

  const after = record(result.after);
  const afterLoudness = record(after.loudness);
  const checks = record(result.final_checks);
  const delta = record(checks.perceptual_delta);
  const plan = record(result.plan);
  const tonal = record(plan.tonal);
  const stereo = record(plan.stereo);

  return {
    jobId: job.id,
    preset: job.preset as MasteringPreferenceEvidence["preset"],
    decision,
    decidedAt: typeof artistDecision.decided_at === "string" ? artistDecision.decided_at : null,
    integratedLufs: finite(afterLoudness.integrated_lufs),
    plrLossLu: finite(delta.plr_loss_lu),
    limiterGainReductionDb: finite(delta.estimated_limiter_gain_reduction_db),
    totalEqEnergy: finite(tonal.total_eq_energy),
    stereoChanged: stereo.enabled === true,
  };
}

export function buildMasteringPreferenceProfile(jobs: MasteringJobLike[]): MasteringPreferenceProfile {
  const evidence = jobs
    .map(masteringPreferenceEvidence)
    .filter((item): item is MasteringPreferenceEvidence => Boolean(item));
  const approved = evidence.filter((item) => item.decision === "approved");
  const creativeApproved = approved.filter((item) => item.preset !== "streaming_safe");

  const lufs = creativeApproved.flatMap((item) => item.integratedLufs === null ? [] : [item.integratedLufs]);
  const limiter = creativeApproved.flatMap((item) => item.limiterGainReductionDb === null ? [] : [item.limiterGainReductionDb]);
  const eqEnergy = creativeApproved.flatMap((item) => item.totalEqEnergy === null ? [] : [item.totalEqEnergy]);
  const evidenceCount = evidence.length;
  const latestDecisionAt = evidence
    .flatMap((item) => item.decidedAt ? [item.decidedAt] : [])
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const confidence = Math.min(0.9, Math.max(0, evidenceCount < 2 ? 0 : 0.4 + Math.log2(evidenceCount + 1) * 0.12));

  return {
    schema: "ensemblis.mastering_preferences.v1",
    evidenceCount,
    approvedCount: approved.length,
    keptOriginalCount: evidence.filter((item) => item.decision === "kept_original").length,
    latestDecisionAt,
    preferredCreativeLufs: median(lufs),
    preferredLimiterGainReductionDb: median(limiter),
    preferredEqEnergy: median(eqEnergy),
    presetApprovals: {
      balanced: creativeApproved.filter((item) => item.preset === "balanced").length,
      punchy: creativeApproved.filter((item) => item.preset === "punchy").length,
      dynamic: creativeApproved.filter((item) => item.preset === "dynamic").length,
    },
    sourcePreservingApprovals: approved.filter((item) => item.preset === "streaming_safe").length,
    confidence,
    boundedInfluence: {
      maxLoudnessNudgeLu: confidence >= 0.7 ? 0.6 : confidence >= 0.5 ? 0.35 : 0,
      mayTightenDamageBudget: confidence >= 0.5,
      mayLoosenTechnicalSafety: false,
    },
  };
}

export function masteringPreferenceWorkerPayload(profile: MasteringPreferenceProfile) {
  return {
    schema: profile.schema,
    evidence_count: profile.evidenceCount,
    approved_count: profile.approvedCount,
    kept_original_count: profile.keptOriginalCount,
    preferred_creative_lufs: profile.preferredCreativeLufs,
    preferred_limiter_gain_reduction_db: profile.preferredLimiterGainReductionDb,
    preferred_eq_energy: profile.preferredEqEnergy,
    preset_approvals: profile.presetApprovals,
    source_preserving_approvals: profile.sourcePreservingApprovals,
    confidence: profile.confidence,
    max_loudness_nudge_lu: profile.boundedInfluence.maxLoudnessNudgeLu,
    may_tighten_damage_budget: profile.boundedInfluence.mayTightenDamageBudget,
  };
}
