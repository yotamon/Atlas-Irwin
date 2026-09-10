export const AUTONOMY_DOMAINS = [
  "analytics_reconciliation",
  "music_analysis",
  "moment_curation",
  "creative_ideation",
  "creative_generation",
  "social_scheduling",
  "social_publishing",
  "audience_replies",
  "paid_growth",
  "outreach",
  "sites",
  "distribution",
] as const;

export type AutonomyDomain = (typeof AUTONOMY_DOMAINS)[number];
export type AutonomyMode = "assist" | "prepare" | "run";
export type AutonomyBehavior = "run" | "prepare" | "ask";

export type AutonomyContract = {
  id: string;
  ownerId: string;
  artistId: string;
  domain: AutonomyDomain;
  mode: AutonomyMode;
  enabled: boolean;
  maxSingleSpendUsd: number | null;
  maxTotalSpendUsd: number | null;
  allowedProviders: string[];
  allowedPlatforms: string[];
  expiresAt: string | null;
};

export type AutonomyEffect = {
  action: string;
  external?: boolean;
  paid?: boolean;
  destructive?: boolean;
  irreversible?: boolean;
  sensitiveCommunication?: boolean;
  legalDeclaration?: boolean;
  distributionSubmission?: boolean;
  estimatedCostUsd?: number | null;
  currentContractSpendUsd?: number | null;
  provider?: string | null;
  platform?: string | null;
};

export type AutonomyDecision = {
  behavior: AutonomyBehavior;
  canExecute: boolean;
  effectiveMode: AutonomyMode;
  contractId: string | null;
  reason: string;
  blockers: string[];
  contract: AutonomyContract | null;
};

export const AUTONOMY_DOMAIN_META: Record<AutonomyDomain, {
  label: string;
  description: string;
  defaultMode: AutonomyMode;
}> = {
  analytics_reconciliation: {
    label: "Analytics & reconciliation",
    description: "Refresh metrics, reconcile safe internal data and repair deterministic data state.",
    defaultMode: "run",
  },
  music_analysis: {
    label: "Music analysis",
    description: "Analyze recordings, lyrics and stems without changing external systems.",
    defaultMode: "run",
  },
  moment_curation: {
    label: "Moment curation",
    description: "Propose and rank useful musical Moments. Artist-approved timing remains authoritative.",
    defaultMode: "run",
  },
  creative_ideation: {
    label: "Creative ideation",
    description: "Prepare concepts, briefs and recommendations without spending or publishing.",
    defaultMode: "run",
  },
  creative_generation: {
    label: "Creative generation",
    description: "Generate media. Paid generation still needs an explicit spend ceiling and existing generation gates.",
    defaultMode: "prepare",
  },
  social_scheduling: {
    label: "Social scheduling",
    description: "Prepare and schedule approved content for connected channels.",
    defaultMode: "prepare",
  },
  social_publishing: {
    label: "Social publishing",
    description: "Publish externally to connected social channels.",
    defaultMode: "prepare",
  },
  audience_replies: {
    label: "Audience replies",
    description: "Prepare replies. Sensitive communication always requires you.",
    defaultMode: "prepare",
  },
  paid_growth: {
    label: "Paid growth",
    description: "Run bounded paid experiments only inside explicit spend and platform rules.",
    defaultMode: "assist",
  },
  outreach: {
    label: "Outreach",
    description: "Prepare external outreach. Sensitive or ambiguous messages always require review.",
    defaultMode: "prepare",
  },
  sites: {
    label: "Artist Sites",
    description: "Prepare site changes automatically; publishing and domain effects require explicit authority.",
    defaultMode: "prepare",
  },
  distribution: {
    label: "Distribution",
    description: "Prepare metadata and delivery state. Final distribution submission always requires you in v1.",
    defaultMode: "assist",
  },
};

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function contains(values: string[], value: string | null | undefined) {
  const target = normalized(value);
  if (!target || !values.length) return true;
  return values.some((entry) => normalized(entry) === target);
}

function activeContract(contract: AutonomyContract | null | undefined, now: Date) {
  if (!contract?.enabled) return null;
  if (!contract.expiresAt) return contract;
  const expiry = Date.parse(contract.expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime() ? contract : null;
}

function decision(input: Omit<AutonomyDecision, "canExecute">): AutonomyDecision {
  return { ...input, canExecute: input.behavior === "run" };
}

export function resolveAutonomyDecision(input: {
  domain: AutonomyDomain;
  contract?: AutonomyContract | null;
  effect: AutonomyEffect;
  now?: Date;
}): AutonomyDecision {
  const now = input.now ?? new Date();
  const contract = activeContract(input.contract, now);
  const mode = contract?.mode ?? AUTONOMY_DOMAIN_META[input.domain].defaultMode;
  const blockers: string[] = [];

  // These are hard product-safety boundaries, not configurable preferences.
  if (input.effect.sensitiveCommunication) blockers.push("Sensitive communication requires explicit artist review.");
  if (input.effect.legalDeclaration) blockers.push("Legal or rights declarations require explicit artist confirmation.");
  if (input.effect.destructive || input.effect.irreversible) blockers.push("Destructive or irreversible effects require explicit artist confirmation.");
  if (input.effect.distributionSubmission || input.domain === "distribution") blockers.push("Distribution submission always requires explicit artist confirmation in autonomy v1.");
  if (blockers.length) {
    return decision({
      behavior: "ask",
      effectiveMode: mode,
      contractId: contract?.id ?? null,
      reason: blockers[0],
      blockers,
      contract,
    });
  }

  if (mode === "assist") {
    return decision({
      behavior: "ask",
      effectiveMode: mode,
      contractId: contract?.id ?? null,
      reason: "Assist mode recommends the action but does not perform it without the artist.",
      blockers: ["Assist mode requires artist approval."],
      contract,
    });
  }

  if (input.effect.provider && contract && !contains(contract.allowedProviders, input.effect.provider)) {
    blockers.push(`Provider ${input.effect.provider} is outside this autonomy contract.`);
  }
  if (input.effect.platform && contract && !contains(contract.allowedPlatforms, input.effect.platform)) {
    blockers.push(`Platform ${input.effect.platform} is outside this autonomy contract.`);
  }

  const estimatedCost = Math.max(0, Number(input.effect.estimatedCostUsd ?? 0));
  const currentSpend = Math.max(0, Number(input.effect.currentContractSpendUsd ?? 0));
  if (input.effect.paid) {
    if (!contract || contract.mode !== "run") {
      blockers.push("Paid execution requires an explicit Run contract.");
    }
    if (contract?.maxSingleSpendUsd == null) {
      blockers.push("Paid execution requires an explicit per-action spend ceiling.");
    } else if (estimatedCost > contract.maxSingleSpendUsd + 0.0001) {
      blockers.push(`Estimated cost $${estimatedCost.toFixed(2)} exceeds the $${contract.maxSingleSpendUsd.toFixed(2)} per-action autonomy ceiling.`);
    }
    if (contract?.maxTotalSpendUsd != null && currentSpend + estimatedCost > contract.maxTotalSpendUsd + 0.0001) {
      blockers.push("This action would exceed the contract total spend ceiling.");
    }
  }

  if (blockers.length) {
    return decision({
      behavior: input.effect.external || input.effect.paid ? "ask" : "prepare",
      effectiveMode: mode,
      contractId: contract?.id ?? null,
      reason: blockers[0],
      blockers,
      contract,
    });
  }

  if (mode === "prepare") {
    if (input.effect.external || input.effect.paid) {
      return decision({
        behavior: "prepare",
        effectiveMode: mode,
        contractId: contract?.id ?? null,
        reason: "Prepare mode may finish internal work, but external effects and spend remain queued for artist approval.",
        blockers: [],
        contract,
      });
    }
    return decision({
      behavior: "run",
      effectiveMode: mode,
      contractId: contract?.id ?? null,
      reason: "Prepare mode allows safe, reversible internal work to run automatically.",
      blockers: [],
      contract,
    });
  }

  if (!contract && (input.effect.external || input.effect.paid)) {
    return decision({
      behavior: "prepare",
      effectiveMode: mode,
      contractId: null,
      reason: "External effects do not inherit implicit Run authority. Create an explicit artist contract first.",
      blockers: [],
      contract: null,
    });
  }

  return decision({
    behavior: "run",
    effectiveMode: mode,
    contractId: contract?.id ?? null,
    reason: input.effect.external
      ? "An active Run contract explicitly authorizes this bounded external effect. Existing provider, spend and approval gates still apply."
      : "This is safe internal work allowed by the effective autonomy mode.",
    blockers: [],
    contract,
  });
}
