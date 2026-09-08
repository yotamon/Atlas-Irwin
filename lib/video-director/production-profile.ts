export const VIDEO_PRODUCTION_PROFILES = [
  "economy",
  "efficient",
  "balanced",
  "high",
  "maximum",
] as const;

export type VideoProductionProfile = (typeof VIDEO_PRODUCTION_PROFILES)[number];

export type VideoProductionProfileDefinition = {
  id: VideoProductionProfile;
  label: string;
  eyebrow: string;
  description: string;
  qualityWeight: number;
  costWeight: number;
  consistencyWeight: number;
  premiumBoost: number;
  testCostBias: number;
};

export const VIDEO_PRODUCTION_PROFILE_DEFINITIONS: readonly VideoProductionProfileDefinition[] = [
  {
    id: "economy",
    label: "Cost efficient",
    eyebrow: "Lean",
    description: "Prefer efficient models and reserve premium generation for shots that truly require it.",
    qualityWeight: 1.1,
    costWeight: 3.4,
    consistencyWeight: 1.1,
    premiumBoost: 0,
    testCostBias: 3.2,
  },
  {
    id: "efficient",
    label: "Efficient",
    eyebrow: "Smart spend",
    description: "Keep quality high while pushing routine shots toward the best value models.",
    qualityWeight: 1.45,
    costWeight: 2.55,
    consistencyWeight: 1.35,
    premiumBoost: 0.35,
    testCostBias: 2.8,
  },
  {
    id: "balanced",
    label: "Balanced",
    eyebrow: "Recommended",
    description: "Balance visual quality, continuity and cost while escalating important shots when justified.",
    qualityWeight: 1.9,
    costWeight: 1.55,
    consistencyWeight: 1.65,
    premiumBoost: 0.9,
    testCostBias: 2.45,
  },
  {
    id: "high",
    label: "Quality first",
    eyebrow: "Premium",
    description: "Prioritize stronger cinematic and consistency models, with cost as a secondary constraint.",
    qualityWeight: 2.75,
    costWeight: 0.75,
    consistencyWeight: 2.2,
    premiumBoost: 2.1,
    testCostBias: 1.9,
  },
  {
    id: "maximum",
    label: "Maximum quality",
    eyebrow: "Flagship",
    description: "Choose the strongest suitable model for each shot unless a hard capability or spend ceiling prevents it.",
    qualityWeight: 3.55,
    costWeight: 0.2,
    consistencyWeight: 2.85,
    premiumBoost: 3.8,
    testCostBias: 1.35,
  },
] as const;

export type VideoProductionPreferences = {
  profile: VideoProductionProfile;
  maxBudgetUsd: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function productionProfileDefinition(profile: VideoProductionProfile) {
  return VIDEO_PRODUCTION_PROFILE_DEFINITIONS.find((item) => item.id === profile)
    ?? VIDEO_PRODUCTION_PROFILE_DEFINITIONS[2];
}

export function parseVideoProductionPreferences(value: unknown): VideoProductionPreferences {
  const brief = record(value);
  const rawProfile = typeof brief.production_profile === "string" ? brief.production_profile : "balanced";
  const profile = VIDEO_PRODUCTION_PROFILES.includes(rawProfile as VideoProductionProfile)
    ? rawProfile as VideoProductionProfile
    : "balanced";
  const rawBudget = typeof brief.max_budget_usd === "number" ? brief.max_budget_usd : null;
  const maxBudgetUsd = rawBudget !== null && Number.isFinite(rawBudget) && rawBudget > 0
    ? Number(rawBudget.toFixed(2))
    : null;
  return { profile, maxBudgetUsd };
}
