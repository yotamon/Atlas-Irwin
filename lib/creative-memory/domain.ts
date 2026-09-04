import type { CreativeMemoryEvent } from "@/types/creative-memory-database";

export type CreativeMemoryPreferenceSummary = {
  positive: string[];
  negative: string[];
  evidenceCount: number;
  summary: string;
};

export type CreativeAssetScoreInput = {
  baseScore: number;
  approvals: number;
  rejections: number;
  uses: number;
  exports: number;
  performanceScore: number | null;
  brandRelevance: number;
  sameRelease: boolean;
  sameTrack: boolean;
  sameMoment: boolean;
  excluded: boolean;
  duplicate: boolean;
};

export type CreativeAssetScore = {
  score: number;
  reasons: string[];
  excluded: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanSignal(value: string | null | undefined) {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 240) : null;
}

function eventStrength(event: CreativeMemoryEvent) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(event.created_at)) / 86_400_000);
  const recency = Math.max(0.55, Math.exp(-ageDays / 240));
  return Number(event.weight || 1) * recency;
}

export function summarizeCreativeMemory(events: CreativeMemoryEvent[]): CreativeMemoryPreferenceSummary {
  const totals = new Map<string, number>();
  for (const event of events) {
    const signal = cleanSignal(event.signal);
    if (!signal || event.sentiment === 0) continue;
    totals.set(signal, (totals.get(signal) ?? 0) + event.sentiment * eventStrength(event));
  }

  const ranked = [...totals.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]));
  const positive = ranked.filter(([, score]) => score > 0.15).slice(0, 12).map(([signal]) => signal);
  const negative = ranked.filter(([, score]) => score < -0.15).slice(0, 12).map(([signal]) => signal);

  return {
    positive,
    negative,
    evidenceCount: events.length,
    summary: events.length
      ? `${events.length} artist-scoped creative decision${events.length === 1 ? "" : "s"} are available as evidence. ${positive.length} preference${positive.length === 1 ? "" : "s"} are currently reinforced and ${negative.length} are discouraged.`
      : "No reviewed creative history exists for this artist yet. Explicit brand settings, release identity and artist-scoped source material remain authoritative.",
  };
}

export function scoreCreativeAsset(input: CreativeAssetScoreInput): CreativeAssetScore {
  if (input.excluded) {
    return { score: Number.NEGATIVE_INFINITY, reasons: ["Explicitly excluded from this artist's Creative Memory."], excluded: true };
  }

  let score = input.baseScore;
  const reasons: string[] = [];

  if (input.sameRelease) {
    score += 24;
    reasons.push("Already belongs to this release world.");
  }
  if (input.sameTrack) {
    score += 14;
    reasons.push("Already linked to this track.");
  }
  if (input.sameMoment) {
    score += 16;
    reasons.push("Previously used with this musical Moment.");
  }

  const approvalBoost = Math.min(54, input.approvals * 18);
  if (approvalBoost) {
    score += approvalBoost;
    reasons.push(`Approved ${input.approvals} time${input.approvals === 1 ? "" : "s"} by the artist.`);
  }

  const rejectionPenalty = Math.min(84, input.rejections * 28);
  if (rejectionPenalty) {
    score -= rejectionPenalty;
    reasons.push(`Previously rejected ${input.rejections} time${input.rejections === 1 ? "" : "s"}; preference reduced.`);
  }

  const useBoost = Math.min(24, Math.log2(input.uses + 1) * 8);
  if (useBoost > 0.5) {
    score += useBoost;
    reasons.push(`Reused in ${input.uses} artist-scoped creative context${input.uses === 1 ? "" : "s"}.`);
  }

  const exportBoost = Math.min(14, input.exports * 5);
  if (exportBoost) {
    score += exportBoost;
    reasons.push("Previously made it into delivered/exported creative.");
  }

  if (input.performanceScore !== null) {
    const performance = clamp(input.performanceScore, 0, 1);
    score += performance * 30;
    if (performance >= 0.7) reasons.push("Strong attributable content performance supports reuse.");
    else if (performance <= 0.25) reasons.push("Attributable performance is weak, so it is not being over-preferred.");
  }

  const relevance = clamp(input.brandRelevance, 0, 1);
  score += (relevance - 0.5) * 40;
  if (relevance >= 0.75) reasons.push("Marked as strongly relevant to this artist's visual identity.");
  if (relevance <= 0.25) reasons.push("Low artist-brand relevance reduces recommendation priority.");

  if (input.duplicate) {
    score -= 35;
    reasons.push("Duplicate or near-duplicate evidence exists; a stronger canonical asset is preferred.");
  }

  return {
    score: Math.round(score * 100) / 100,
    reasons: reasons.slice(0, 5),
    excluded: false,
  };
}

export function performanceEvidenceScore(input: {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  follows: number;
  linkClicks: number;
}) {
  const exposure = Math.max(0, input.views, input.reach);
  const engagements = Math.max(0, input.likes + input.comments + input.shares + input.saves);
  const engagementRate = engagements / Math.max(1, exposure);
  const conversion = Math.max(0, input.follows + input.linkClicks);
  const scaleScore = clamp(Math.log10(exposure + 1) / 5, 0, 1);
  const engagementScore = clamp(engagementRate / 0.08, 0, 1);
  const conversionScore = clamp(Math.log10(conversion + 1) / 2.5, 0, 1);
  return Math.round((scaleScore * 0.45 + engagementScore * 0.4 + conversionScore * 0.15) * 10_000) / 10_000;
}
