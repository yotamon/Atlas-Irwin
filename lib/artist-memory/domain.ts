export type ArtistMemoryClass =
  | "identity"
  | "creative_rule"
  | "preference_evidence"
  | "performance_learning"
  | "strategic_constraint"
  | "provenance_compliance";

export type ArtistMemoryLifecycle = "active" | "candidate" | "disabled" | "expired";

export type ArtistMemoryConfidenceLabel = "explicit" | "high" | "medium" | "low";

export type ArtistMemoryConsumer =
  | "moment_ranking"
  | "creative_direction"
  | "video_director"
  | "campaign_planning"
  | "growth"
  | "audience_assistance"
  | "mastering";

export type ArtistMemoryEffect = "rank_only" | "suggest_only" | "brief_only" | "prepare_copy_only";

export type ArtistMemoryConsumerPolicy = {
  consumer: ArtistMemoryConsumer;
  allowedClasses: ArtistMemoryClass[];
  maxEffect: ArtistMemoryEffect;
  maxItems: number;
  minimumLearnedConfidence: number;
  description: string;
};

export const ARTIST_MEMORY_CONSUMER_POLICY: Record<ArtistMemoryConsumer, ArtistMemoryConsumerPolicy> = {
  moment_ranking: {
    consumer: "moment_ranking",
    allowedClasses: ["preference_evidence", "performance_learning"],
    maxEffect: "rank_only",
    maxItems: 6,
    minimumLearnedConfidence: 0.7,
    description: "May reorder otherwise valid Moment proposals. Explicit Moment calibration is Moment-specific; it may not alter source timing, approval state or create broader artist truth.",
  },
  creative_direction: {
    consumer: "creative_direction",
    allowedClasses: ["identity", "creative_rule", "preference_evidence", "performance_learning", "provenance_compliance"],
    maxEffect: "brief_only",
    maxItems: 8,
    minimumLearnedConfidence: 0.55,
    description: "May shape a creative brief and recommendation. Explicit artist guidance outranks learned preferences.",
  },
  video_director: {
    consumer: "video_director",
    allowedClasses: ["identity", "creative_rule", "preference_evidence", "performance_learning", "provenance_compliance"],
    maxEffect: "brief_only",
    maxItems: 8,
    minimumLearnedConfidence: 0.55,
    description: "May shape direction and shot recommendations. It cannot approve paid generation or replace artist-approved source media.",
  },
  campaign_planning: {
    consumer: "campaign_planning",
    allowedClasses: ["identity", "creative_rule", "preference_evidence", "performance_learning", "strategic_constraint", "provenance_compliance"],
    maxEffect: "suggest_only",
    maxItems: 8,
    minimumLearnedConfidence: 0.65,
    description: "May suggest campaign emphasis and sequencing. Publishing, spend and external effects remain governed elsewhere.",
  },
  growth: {
    consumer: "growth",
    allowedClasses: ["performance_learning", "strategic_constraint"],
    maxEffect: "rank_only",
    maxItems: 6,
    minimumLearnedConfidence: 0.65,
    description: "May rank growth opportunities using verified artist-specific evidence. It cannot manufacture evidence or spend authority.",
  },
  audience_assistance: {
    consumer: "audience_assistance",
    allowedClasses: ["identity", "creative_rule", "provenance_compliance"],
    maxEffect: "prepare_copy_only",
    maxItems: 6,
    minimumLearnedConfidence: 0.8,
    description: "May prepare artist-consistent wording only. It cannot infer consent, sensitive traits, identity merges or permission to send.",
  },
  mastering: {
    consumer: "mastering",
    allowedClasses: ["preference_evidence"],
    maxEffect: "suggest_only",
    maxItems: 4,
    minimumLearnedConfidence: 0.5,
    description: "May nudge creative mastering targets or tighten change budgets from explicit approved/kept-original decisions. It cannot loosen technical safety, change streaming-safe behavior or promote a candidate.",
  },
};

export type ArtistMemorySource = {
  kind: "brand_setting" | "creative_memory" | "moment_calibration" | "verified_learning" | "mastering_preference";
  id: string | null;
  label: string;
  href: string;
  observedAt: string | null;
};

export type ArtistMemoryItem = {
  id: string;
  class: ArtistMemoryClass;
  title: string;
  value: string;
  summary: string;
  source: ArtistMemorySource;
  confidence: {
    score: number;
    label: ArtistMemoryConfidenceLabel;
    sampleSize: number | null;
  };
  lifecycle: ArtistMemoryLifecycle;
  expiresAt: string | null;
  consumers: ArtistMemoryConsumer[];
};

export type ArtistMemorySnapshot = {
  items: ArtistMemoryItem[];
  activeCount: number;
  explicitCount: number;
  learnedCount: number;
  candidateCount: number;
  summary: string;
};

export type ArtistMemoryConsumerSnapshot = {
  consumer: ArtistMemoryConsumer;
  maxEffect: ArtistMemoryEffect;
  policy: ArtistMemoryConsumerPolicy;
  items: ArtistMemoryItem[];
  summary: string;
};

const BRAND_CLASS_BY_SECTION: Record<string, ArtistMemoryClass> = {
  "Brand essence": "identity",
  "Voice and tone": "identity",
  "Music world": "identity",
  "Visual world": "identity",
  Audience: "identity",
  "Visual continuity rules": "creative_rule",
  "Approved phrases": "creative_rule",
  "Words to avoid": "creative_rule",
  "AI narrative guidance": "provenance_compliance",
  "Visual exclusions": "creative_rule",
  "Preferred content formats": "creative_rule",
  "CTA library": "creative_rule",
  "Caption templates": "creative_rule",
  "Visual prompt templates": "creative_rule",
  "Outreach message templates": "creative_rule",
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function confidenceLabel(score: number, explicit = false): ArtistMemoryConfidenceLabel {
  if (explicit) return "explicit";
  if (score >= 0.8) return "high";
  if (score >= 0.55) return "medium";
  return "low";
}

function clean(value: string | null | undefined, max = 2_000) {
  return value?.trim().replace(/\s+/g, " ").slice(0, max) || "";
}

export function brandSettingMemoryItem(input: {
  id: string;
  section: string;
  text: string;
  updatedAt?: string | null;
}): ArtistMemoryItem | null {
  const value = clean(input.text);
  if (!value) return null;
  const memoryClass = BRAND_CLASS_BY_SECTION[input.section] ?? "creative_rule";
  return {
    id: `brand:${input.id}`,
    class: memoryClass,
    title: input.section,
    value,
    summary: "Explicit artist guidance. This outranks inferred preferences and weak performance priors.",
    source: {
      kind: "brand_setting",
      id: input.id,
      label: "Artist-authored brand system",
      href: "/studio/brand",
      observedAt: input.updatedAt ?? null,
    },
    confidence: { score: 1, label: "explicit", sampleSize: null },
    lifecycle: "active",
    expiresAt: null,
    consumers: ["creative_direction", "video_director", "campaign_planning", "growth", "audience_assistance"],
  };
}

export function creativePreferenceMemoryItems(input: {
  positive: string[];
  negative: string[];
  evidenceCount: number;
}): ArtistMemoryItem[] {
  if (!input.evidenceCount) return [];
  const score = clamp01(0.45 + Math.min(0.5, Math.log2(input.evidenceCount + 1) / 10));
  const common = {
    source: {
      kind: "creative_memory" as const,
      id: null,
      label: `${input.evidenceCount} reviewed creative decision${input.evidenceCount === 1 ? "" : "s"}`,
      href: "/studio/library",
      observedAt: null,
    },
    confidence: {
      score,
      label: confidenceLabel(score),
      sampleSize: input.evidenceCount,
    },
    lifecycle: "active" as const,
    expiresAt: null,
    consumers: ["creative_direction", "video_director", "campaign_planning"] as ArtistMemoryConsumer[],
  };
  const items: ArtistMemoryItem[] = [];
  if (input.positive.length) {
    const value = input.positive.slice(0, 12).join(" · ");
    items.push({
      id: "creative:reinforced",
      class: "preference_evidence",
      title: "Creative preferences Ensemblis should reinforce",
      value,
      summary: "Repeated approvals and use make these signals more likely to be useful again. They never override explicit artist rules.",
      ...common,
    });
  }
  if (input.negative.length) {
    const value = input.negative.slice(0, 12).join(" · ");
    items.push({
      id: "creative:discouraged",
      class: "preference_evidence",
      title: "Creative directions Ensemblis should avoid",
      value,
      summary: "Repeated rejections reduce these signals in future recommendations without deleting the underlying creative history.",
      ...common,
    });
  }
  return items;
}

export function momentCalibrationMemoryItem(input: {
  eventId: string;
  releaseId: string;
  momentLabel: string;
  judgment: "best" | "useful" | "poor" | "adjustment";
  correctedPurpose?: string | null;
  preferredCutSeconds?: number | null;
  preferredMomentLabel?: string | null;
  observedAt?: string | null;
}): ArtistMemoryItem {
  const judgment = input.judgment === "best"
    ? "Favorite Moment"
    : input.judgment === "useful"
      ? "Useful Moment"
      : input.judgment === "poor"
        ? "Avoid this Moment"
        : "Adjusted Moment";
  const details = [
    input.correctedPurpose ? `purpose: ${clean(input.correctedPurpose, 180)}` : "",
    input.preferredCutSeconds ? `preferred cut: ${input.preferredCutSeconds}s` : "",
    input.preferredMomentLabel ? `prefer: ${clean(input.preferredMomentLabel, 180)}` : "",
  ].filter(Boolean);
  return {
    id: `moment-calibration:${input.eventId}`,
    class: "preference_evidence",
    title: `${judgment}: ${clean(input.momentLabel, 180)}`,
    value: details.length ? details.join(" · ") : judgment,
    summary: "Explicit Moment-specific artist calibration. Use it only as bounded preference evidence; never generalize it into source analysis or rewrite musical timing.",
    source: {
      kind: "moment_calibration",
      id: input.eventId,
      label: "Best Moments review",
      href: `/studio/releases/${input.releaseId}?stage=create#moments`,
      observedAt: input.observedAt ?? null,
    },
    confidence: { score: 1, label: "explicit", sampleSize: 1 },
    lifecycle: "active",
    expiresAt: null,
    consumers: ["moment_ranking", "creative_direction", "video_director", "campaign_planning"],
  };
}

export function masteringPreferenceMemoryItems(input: {
  evidenceCount: number;
  approvedCount: number;
  keptOriginalCount: number;
  preferredCreativeLufs: number | null;
  preferredLimiterGainReductionDb: number | null;
  preferredEqEnergy: number | null;
  confidence: number;
  observedAt?: string | null;
}): ArtistMemoryItem[] {
  if (input.evidenceCount < 2 || input.confidence < 0.5) return [];
  const items: ArtistMemoryItem[] = [];
  const source = {
    kind: "mastering_preference" as const,
    id: null,
    label: `${input.evidenceCount} explicit mastering decision${input.evidenceCount === 1 ? "" : "s"}`,
    href: "/studio/music",
    observedAt: input.observedAt ?? null,
  };
  const confidence = {
    score: clamp01(input.confidence),
    label: confidenceLabel(input.confidence),
    sampleSize: input.evidenceCount,
  };
  const common = {
    source,
    confidence,
    lifecycle: "active" as const,
    expiresAt: null,
    consumers: ["mastering"] as ArtistMemoryConsumer[],
  };

  if (input.preferredCreativeLufs !== null) {
    items.push({
      id: "mastering:creative-loudness",
      class: "preference_evidence",
      title: "Mastering loudness preference",
      value: `Approved creative masters cluster around ${input.preferredCreativeLufs.toFixed(1)} LUFS.`,
      summary: "Derived only from explicit mastering approvals. Future creative targets may move slightly toward this history, but technical safety and the cleanest acceptable loudness remain authoritative.",
      ...common,
    });
  }

  if (input.preferredLimiterGainReductionDb !== null || input.preferredEqEnergy !== null) {
    const details = [
      input.preferredLimiterGainReductionDb !== null
        ? `typical approved peak-control pressure ≈ ${input.preferredLimiterGainReductionDb.toFixed(1)} dB`
        : "",
      input.preferredEqEnergy !== null
        ? `typical approved EQ movement ≈ ${input.preferredEqEnergy.toFixed(1)} dB total`
        : "",
    ].filter(Boolean);
    items.push({
      id: "mastering:change-tolerance",
      class: "preference_evidence",
      title: "Mastering change tolerance",
      value: details.join(" · "),
      summary: "Approved candidates can tighten future processing budgets. Learned preference evidence is never allowed to loosen technical safety limits.",
      ...common,
    });
  }

  if (!items.length) {
    items.push({
      id: "mastering:decision-history",
      class: "preference_evidence",
      title: "Mastering decision history",
      value: `${input.approvedCount} approved · ${input.keptOriginalCount} original kept`,
      summary: "Explicit mastering decisions are retained as bounded artist-specific evidence without inventing a universal quality score.",
      ...common,
    });
  }

  return items;
}

export function verifiedLearningMemoryItem(input: {
  id: string;
  scope: string;
  finding: string;
  confidence: number;
  sampleSize?: number | null;
  source?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
}): ArtistMemoryItem | null {
  const value = clean(input.finding);
  if (!value) return null;
  const score = clamp01(Number(input.confidence));
  return {
    id: `learning:${input.id}`,
    class: "performance_learning",
    title: input.scope || "Verified performance learning",
    value,
    summary: "Approved, attributed outcome evidence. Its effect is bounded and stops influencing decisions when the evidence expires.",
    source: {
      kind: "verified_learning",
      id: input.id,
      label: input.source || "Verified outcome learning",
      href: "/studio/learn",
      observedAt: input.observedAt ?? null,
    },
    confidence: {
      score,
      label: confidenceLabel(score),
      sampleSize: input.sampleSize ?? null,
    },
    lifecycle: input.expired ? "expired" : "active",
    expiresAt: input.expiresAt ?? null,
    consumers: ["moment_ranking", "creative_direction", "campaign_planning", "growth"],
  };
}

export function summarizeArtistMemory(items: ArtistMemoryItem[]): ArtistMemorySnapshot {
  const active = items.filter((item) => item.lifecycle === "active");
  const explicitCount = active.filter((item) => item.confidence.label === "explicit").length;
  const learnedCount = active.filter((item) => item.confidence.label !== "explicit").length;
  const candidateCount = items.filter((item) => item.lifecycle === "candidate").length;
  return {
    items,
    activeCount: active.length,
    explicitCount,
    learnedCount,
    candidateCount,
    summary: active.length
      ? `${active.length} active memory item${active.length === 1 ? "" : "s"}: ${explicitCount} explicit artist signal${explicitCount === 1 ? "" : "s"} and ${learnedCount} evidence-backed learned signal${learnedCount === 1 ? "" : "s"}.`
      : "Ensemblis has no durable artist memory yet. Explicit artist guidance will become the first source of truth.",
  };
}

export function artistMemoryForConsumer(snapshot: ArtistMemorySnapshot, consumer: ArtistMemoryConsumer): ArtistMemoryConsumerSnapshot {
  const policy = ARTIST_MEMORY_CONSUMER_POLICY[consumer];
  const items = snapshot.items
    .filter((item) => item.lifecycle === "active")
    .filter((item) => item.consumers.includes(consumer))
    .filter((item) => policy.allowedClasses.includes(item.class))
    .filter((item) => item.confidence.label === "explicit" || item.confidence.score >= policy.minimumLearnedConfidence)
    .sort((left, right) => {
      const explicit = Number(right.confidence.label === "explicit") - Number(left.confidence.label === "explicit");
      if (explicit) return explicit;
      return right.confidence.score - left.confidence.score || left.title.localeCompare(right.title);
    })
    .slice(0, policy.maxItems);
  return {
    consumer,
    maxEffect: policy.maxEffect,
    policy,
    items,
    summary: items.length
      ? `${items.length} bounded Artist Memory signal${items.length === 1 ? "" : "s"} available for ${consumer.replaceAll("_", " ")}. Maximum effect: ${policy.maxEffect.replaceAll("_", " ")}.`
      : `No qualifying Artist Memory is active for ${consumer.replaceAll("_", " ")}.`,
  };
}
