export const MOMENT_LEARNING_TRAITS = [
  "vocal_score",
  "hook_score",
  "emotional_score",
  "energy_score",
  "uniqueness_score",
] as const;

export const MOMENT_LEARNING_METRICS = [
  "save_rate",
  "follow_rate",
  "click_rate",
  "engagement_rate",
] as const;

export type MomentLearningTrait = (typeof MOMENT_LEARNING_TRAITS)[number];
export type MomentLearningMetric = (typeof MOMENT_LEARNING_METRICS)[number];

export type MomentTraitPreferenceEffect = {
  kind: "moment_trait_preference";
  trait: MomentLearningTrait;
  direction: "higher" | "lower";
  weight: number;
  metric: MomentLearningMetric;
  platform?: string;
  format?: string;
  goal?: string;
};

function isStringMember<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function parseMomentTraitPreferenceEffect(value: unknown): MomentTraitPreferenceEffect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const effect = value as Record<string, unknown>;
  if (effect.kind !== "moment_trait_preference") return null;
  if (!isStringMember(MOMENT_LEARNING_TRAITS, effect.trait)) return null;
  if (effect.direction !== "higher" && effect.direction !== "lower") return null;
  if (!isStringMember(MOMENT_LEARNING_METRICS, effect.metric)) return null;
  if (typeof effect.weight !== "number" || !Number.isFinite(effect.weight) || effect.weight < 0 || effect.weight > 0.3) return null;
  for (const key of ["platform", "format", "goal"] as const) {
    if (effect[key] !== undefined && typeof effect[key] !== "string") return null;
  }
  return effect as MomentTraitPreferenceEffect;
}

function humanize(value: string) {
  return value.replace(/_score$/, "").replace(/_/g, " ");
}

export function describeLearningEffect(value: unknown) {
  const effect = parseMomentTraitPreferenceEffect(value);
  if (!effect) return "Evidence memory only. No executable ranking rule is attached.";
  const scope = [effect.platform, effect.format, effect.goal].filter(Boolean).join(" · ");
  return `If approved, Ensemblis may give a bounded ${Math.round(effect.weight * 100)}% ranking weight toward ${effect.direction} ${humanize(effect.trait)} Moments${scope ? ` for ${scope}` : ""}. Signal: ${humanize(effect.metric)}.`;
}
