export type MissionStateLanguage =
  | "blocked"
  | "needs_attention"
  | "planned"
  | "prepared"
  | "on_track"
  | "archived";

export type MissionStateLabel =
  | "Blocked"
  | "Needs attention"
  | "Planned"
  | "Prepared"
  | "On track"
  | "Archived";

export type DecisionSeverityLanguage = "required" | "decision" | "review";
export type DecisionSeverityLabel = "Required" | "Needs You" | "Recommended";

export type MissionAttentionLanguage = "blocking" | "recommended" | "optional";
export type MissionAttentionLabel = "Required" | "Recommended" | "Optional";

export type WorkPostureLanguage = "working" | "needs_you" | "planned" | "prepared";
export type WorkPostureLabel = "Working" | "Needs You" | "Planned" | "Prepared";

export type EvidenceConfidenceLanguage = "explicit" | "high" | "medium" | "low";
export type AutonomyModeLanguage = "assist" | "prepare" | "run";
export type AutonomyBehaviorLanguage = "ask" | "prepare" | "run";

const MISSION_STATE_LABELS: Record<MissionStateLanguage, MissionStateLabel> = {
  blocked: "Blocked",
  needs_attention: "Needs attention",
  planned: "Planned",
  prepared: "Prepared",
  on_track: "On track",
  archived: "Archived",
};

const DECISION_SEVERITY_LABELS: Record<DecisionSeverityLanguage, DecisionSeverityLabel> = {
  required: "Required",
  decision: "Needs You",
  review: "Recommended",
};

const MISSION_ATTENTION_LABELS: Record<MissionAttentionLanguage, MissionAttentionLabel> = {
  blocking: "Required",
  recommended: "Recommended",
  optional: "Optional",
};

const WORK_POSTURE_LABELS: Record<WorkPostureLanguage, WorkPostureLabel> = {
  working: "Working",
  needs_you: "Needs You",
  planned: "Planned",
  prepared: "Prepared",
};

const AUTONOMY_MODE_LABELS: Record<AutonomyModeLanguage, "Assist" | "Prepare" | "Run"> = {
  assist: "Assist",
  prepare: "Prepare",
  run: "Run",
};

const AUTONOMY_BEHAVIOR_LABELS: Record<AutonomyBehaviorLanguage, "Needs You" | "Prepared" | "Working"> = {
  ask: "Needs You",
  prepare: "Prepared",
  run: "Working",
};

export function missionStateLabel(state: MissionStateLanguage): MissionStateLabel {
  return MISSION_STATE_LABELS[state];
}

export function decisionSeverityLabel(severity: DecisionSeverityLanguage): DecisionSeverityLabel {
  return DECISION_SEVERITY_LABELS[severity];
}

export function missionAttentionLabel(attention: MissionAttentionLanguage): MissionAttentionLabel {
  return MISSION_ATTENTION_LABELS[attention];
}

export function workPostureLabel(posture: WorkPostureLanguage): WorkPostureLabel {
  return WORK_POSTURE_LABELS[posture];
}

export function autonomyModeLabel(mode: AutonomyModeLanguage) {
  return AUTONOMY_MODE_LABELS[mode];
}

export function autonomyBehaviorLabel(behavior: AutonomyBehaviorLanguage) {
  return AUTONOMY_BEHAVIOR_LABELS[behavior];
}

export function evidenceConfidenceLabel(
  confidence: EvidenceConfidenceLanguage,
  sampleSize: number | null = null,
) {
  const label = confidence === "explicit"
    ? "Artist rule"
    : confidence === "high"
      ? "Strong evidence"
      : confidence === "medium"
        ? "Supported by evidence"
        : "Preliminary evidence";
  if (!sampleSize || confidence === "explicit") return label;
  return `${label} · ${sampleSize} reviewed decision${sampleSize === 1 ? "" : "s"}`;
}

export function evidenceFreshnessLabel({
  observedAt,
  expiresAt = null,
  now = new Date(),
}: {
  observedAt: string | null | undefined;
  expiresAt?: string | null;
  now?: Date;
}) {
  if (expiresAt) {
    const expiry = Date.parse(expiresAt);
    if (Number.isFinite(expiry) && expiry <= now.getTime()) return "Expired evidence";
    if (Number.isFinite(expiry) && expiry - now.getTime() <= 14 * 86_400_000) return "Expires soon";
  }
  if (!observedAt) return "Freshness unknown";
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) return "Freshness unknown";
  const age = Math.max(0, now.getTime() - observed);
  if (age <= 30 * 86_400_000) return "Recent evidence";
  if (age <= 90 * 86_400_000) return "Current evidence";
  return "Older evidence";
}
