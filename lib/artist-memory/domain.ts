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
  | "audience_assistance";

export type ArtistMemorySource = {
  kind: "brand_setting" | "creative_memory" | "verified_learning";
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
  const learnedCount = active.filter((item) => item.source.kind !== "brand_setting").length;
  const candidateCount = items.filter((item) => item.lifecycle === "candidate").length;
  return {
    items,
    activeCount: active.length,
    explicitCount,
    learnedCount,
    candidateCount,
    summary: active.length
      ? `${active.length} active memory item${active.length === 1 ? "" : "s"}: ${explicitCount} explicit artist rule${explicitCount === 1 ? "" : "s"} and ${learnedCount} evidence-backed learned signal${learnedCount === 1 ? "" : "s"}.`
      : "Ensemblis has no durable artist memory yet. Explicit artist guidance will become the first source of truth.",
  };
}
