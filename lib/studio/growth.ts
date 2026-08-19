import type { MetricSnapshot } from "@/types/database";
import type { GrowthSettings, VaultTrack } from "@/types/growth-database";

const DAY = 86_400_000;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function utcDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`);
}

export type VaultScore = {
  score: number;
  eligible: boolean;
  components: Record<string, number>;
  reasons: string[];
  blocker: string | null;
};

const componentLabels: Record<string, string> = {
  artist: "your own rating",
  hook: "hook strength",
  shortForm: "short-form potential",
  unique: "distinctiveness",
  readiness: "release readiness",
  visual: "visual potential",
};

export function scoreVaultTrack(track: VaultTrack, now = new Date()): VaultScore {
  if (["released", "archived", "scheduled"].includes(track.status)) {
    return { score: 0, eligible: false, components: {}, reasons: [], blocker: `Track is already ${track.status}.` };
  }
  if (track.status === "hold" && (!track.hold_until || utcDate(track.hold_until).getTime() > now.getTime())) {
    return { score: 0, eligible: false, components: {}, reasons: [], blocker: track.hold_until ? `On hold until ${track.hold_until}.` : "Track is on hold." };
  }

  const artist = (track.artist_rating ?? 3) * 20;
  const components = {
    artist,
    hook: track.hook_strength,
    shortForm: track.short_form_potential,
    unique: track.uniqueness_score,
    readiness: track.release_readiness,
    visual: track.visual_potential,
  };
  const statusAdjustment: Record<string, number> = {
    idea: -18,
    demo: -12,
    mix: -6,
    mastered: 0,
    release_candidate: 4,
    hold: -4,
  };
  const weighted =
    artist * 0.2 +
    track.hook_strength * 0.25 +
    track.short_form_potential * 0.2 +
    track.uniqueness_score * 0.15 +
    track.release_readiness * 0.15 +
    track.visual_potential * 0.05 +
    (statusAdjustment[track.status] ?? 0);
  const score = Math.round(clamp(weighted) * 10) / 10;
  const reasons = Object.entries(components)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, value]) => `${componentLabels[key]} ${Math.round(value)}/100`);
  return { score, eligible: true, components, reasons, blocker: null };
}

export function rankVaultTracks(tracks: VaultTrack[], now = new Date()) {
  return tracks
    .map((track) => ({ track, ...scoreVaultTrack(track, now) }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return b.score - a.score;
    });
}

function nextFridayOnOrAfter(input: Date) {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 12));
  const day = date.getUTCDay();
  const delta = (5 - day + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date;
}

function tooClose(candidate: Date, locked: Date[], spacingDays: number) {
  return locked.some((date) => Math.abs(candidate.getTime() - date.getTime()) < spacingDays * DAY);
}

export type PlannedReleaseCandidate = {
  track: VaultTrack;
  targetDate: string;
  score: number;
  rationale: string;
};

export function planReleaseQueue({
  tracks,
  existingReleaseDates,
  settings,
  now = new Date(),
}: {
  tracks: VaultTrack[];
  existingReleaseDates: string[];
  settings: Pick<GrowthSettings, "planning_horizon_days" | "release_cadence_days" | "minimum_candidate_score">;
  now?: Date;
}): PlannedReleaseCandidate[] {
  const horizon = new Date(now.getTime() + settings.planning_horizon_days * DAY);
  const locked = existingReleaseDates
    .filter(Boolean)
    .map(utcDate)
    .filter((date) => date.getTime() >= now.getTime() - DAY && date.getTime() <= horizon.getTime());
  const spacing = Math.max(7, Math.round(settings.release_cadence_days * 0.72));
  let cursor = nextFridayOnOrAfter(new Date(now.getTime() + 21 * DAY));
  const ranked = rankVaultTracks(tracks, now).filter(
    (item) => item.eligible && item.score >= settings.minimum_candidate_score && !item.track.linked_release_id,
  );
  const result: PlannedReleaseCandidate[] = [];

  for (const candidate of ranked) {
    while (tooClose(cursor, [...locked, ...result.map((item) => utcDate(item.targetDate))], spacing)) {
      cursor = nextFridayOnOrAfter(new Date(cursor.getTime() + 7 * DAY));
    }
    if (cursor.getTime() > horizon.getTime()) break;
    result.push({
      track: candidate.track,
      targetDate: dateOnly(cursor),
      score: candidate.score,
      rationale: `Best current portfolio fit because of ${candidate.reasons.join(", ")}.`,
    });
    cursor = nextFridayOnOrAfter(new Date(cursor.getTime() + settings.release_cadence_days * DAY));
  }
  return result;
}

export type GrowthFunnel = {
  reach: number;
  views: number;
  profileVisits: number;
  linkClicks: number;
  listeners: number;
  streams: number;
  saves: number;
  follows: number;
  playlistAdds: number;
  profileVisitRate: number;
  linkClickRate: number;
  listenerConversionRate: number;
  saveRate: number;
  followRate: number;
  streamsPerListener: number;
  fanSignalScore: number;
};

export function buildGrowthFunnel(metrics: MetricSnapshot[]): GrowthFunnel {
  const total = (key: keyof MetricSnapshot) => metrics.reduce((sum, row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
  const reach = total("reach") || total("views");
  const views = total("views");
  const profileVisits = total("profile_visits");
  const linkClicks = total("link_clicks");
  const listeners = total("listeners");
  const streams = total("streams");
  const saves = total("saves");
  const follows = total("follows");
  const playlistAdds = total("playlist_adds");
  return {
    reach,
    views,
    profileVisits,
    linkClicks,
    listeners,
    streams,
    saves,
    follows,
    playlistAdds,
    profileVisitRate: safeRate(profileVisits, reach),
    linkClickRate: safeRate(linkClicks, profileVisits),
    listenerConversionRate: safeRate(listeners, linkClicks),
    saveRate: safeRate(saves, listeners || streams),
    followRate: safeRate(follows, listeners || streams),
    streamsPerListener: listeners > 0 ? streams / listeners : 0,
    fanSignalScore: Math.round(saves * 2 + follows * 4 + playlistAdds * 3 + Math.max(0, streams - listeners) * 0.15),
  };
}

export type FunnelDiagnosis = {
  key: string;
  label: string;
  actual: number;
  target: number;
  severity: number;
  diagnosis: string;
  action: string;
} | null;

export function diagnoseGrowthFunnel(funnel: GrowthFunnel): FunnelDiagnosis {
  const candidates = [
    funnel.reach > 0 ? {
      key: "profile_visit",
      label: "View → profile",
      actual: funnel.profileVisitRate,
      target: 0.02,
      diagnosis: "Discovery is not turning into enough artist curiosity.",
      action: "Strengthen the artist identity, opening frame and profile-facing CTA before increasing posting volume.",
    } : null,
    funnel.profileVisits > 0 ? {
      key: "link_click",
      label: "Profile → music",
      actual: funnel.linkClickRate,
      target: 0.22,
      diagnosis: "People reach the profile but too few continue to the music.",
      action: "Make one release the obvious next action and reduce competing links or unclear calls to action.",
    } : null,
    funnel.linkClicks > 0 ? {
      key: "listener_conversion",
      label: "Click → listener",
      actual: funnel.listenerConversionRate,
      target: 0.35,
      diagnosis: "Traffic is reaching the destination without converting into listeners.",
      action: "Check destination friction, smart-link routing and whether the creative promise matches the track.",
    } : null,
    (funnel.listeners || funnel.streams) > 0 ? {
      key: "save",
      label: "Listener → save",
      actual: funnel.saveRate,
      target: 0.08,
      diagnosis: "Listeners are sampling the music but not retaining it strongly enough.",
      action: "Prioritize the tracks and hooks that create repeat intent, then test save-oriented messaging only after the music signal is strong.",
    } : null,
    (funnel.listeners || funnel.streams) > 0 ? {
      key: "follow",
      label: "Listener → follow",
      actual: funnel.followRate,
      target: 0.05,
      diagnosis: "Listening is not becoming a durable artist relationship.",
      action: "Connect releases into a recognizable Atlas Irwin world and give listeners a reason to expect the next chapter.",
    } : null,
  ].filter(Boolean) as Array<Omit<NonNullable<FunnelDiagnosis>, "severity">>;
  if (!candidates.length) return null;
  const ranked = candidates
    .map((item) => ({ ...item, severity: clamp(1 - item.actual / item.target, 0, 1) }))
    .sort((a, b) => b.severity - a.severity);
  return ranked[0]?.severity > 0.05 ? ranked[0] : null;
}

export type GrowthOpportunityDraft = {
  kind: "catalog_revival" | "content_breakout" | "release_risk" | "funnel_bottleneck" | "release_candidate";
  releaseId?: string | null;
  trackVaultId?: string | null;
  contentItemId?: string | null;
  title: string;
  rationale: string;
  priority: number;
  confidence: number;
  evidence: Record<string, unknown>;
  recommendedAction: Record<string, unknown>;
  dedupeKey: string;
};

type ReleaseSignal = { id: string; title: string; status: string; release_date?: string | null };
type ContentSignal = { id: string; release_id?: string | null; title: string; status: string; asset_url?: string | null };

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function detectGrowthOpportunities({
  releases,
  metrics,
  content,
  vault,
  now = new Date(),
}: {
  releases: ReleaseSignal[];
  metrics: MetricSnapshot[];
  content: ContentSignal[];
  vault: VaultTrack[];
  now?: Date;
}): GrowthOpportunityDraft[] {
  const opportunities: GrowthOpportunityDraft[] = [];
  const funnel = buildGrowthFunnel(metrics);
  const diagnosis = diagnoseGrowthFunnel(funnel);
  if (diagnosis) {
    opportunities.push({
      kind: "funnel_bottleneck",
      title: `${diagnosis.label} is the current growth bottleneck`,
      rationale: diagnosis.diagnosis,
      priority: Math.round(65 + diagnosis.severity * 25),
      confidence: 0.82,
      evidence: { actual: diagnosis.actual, target: diagnosis.target, funnel },
      recommendedAction: { type: "optimize_funnel", action: diagnosis.action },
      dedupeKey: `funnel:${diagnosis.key}`,
    });
  }

  const live = releases.filter((release) => release.status === "Live");
  const releaseStats = live.map((release) => {
    const rows = metrics.filter((metric) => metric.release_id === release.id);
    const f = buildGrowthFunnel(rows);
    return { release, funnel: f, saveRate: f.saveRate, followRate: f.followRate };
  }).filter((item) => item.funnel.listeners >= 20 || item.funnel.views >= 300);
  const medianSaveRate = median(releaseStats.map((item) => item.saveRate).filter((value) => value > 0));
  for (const item of releaseStats) {
    const meaningful = item.saveRate >= Math.max(0.06, medianSaveRate * 1.4) || item.followRate >= 0.045;
    if (!meaningful) continue;
    const priority = clamp(Math.round(62 + item.saveRate * 220 + item.followRate * 160), 62, 94);
    opportunities.push({
      kind: "catalog_revival",
      releaseId: item.release.id,
      title: `${item.release.title} is showing catalog revival potential`,
      rationale: "The track is converting listeners into durable signals better than the current catalog baseline.",
      priority,
      confidence: item.funnel.listeners >= 100 ? 0.88 : 0.7,
      evidence: { saveRate: item.saveRate, followRate: item.followRate, listeners: item.funnel.listeners, streams: item.funnel.streams },
      recommendedAction: { type: "catalog_revival", durationDays: 7, objective: "Streams" },
      dedupeKey: `catalog:${item.release.id}`,
    });
  }

  const contentStats = content.map((item) => {
    const rows = metrics.filter((metric) => metric.content_item_id === item.id);
    const f = buildGrowthFunnel(rows);
    const denominator = f.views || f.reach;
    const qualityRate = denominator > 0 ? (f.saves + f.playlistAdds + f.follows * 2) / denominator : 0;
    return { item, funnel: f, qualityRate };
  }).filter((item) => (item.funnel.views || item.funnel.reach) >= 300);
  const medianQuality = median(contentStats.map((item) => item.qualityRate).filter((value) => value > 0));
  for (const item of contentStats) {
    if (!medianQuality || item.qualityRate < Math.max(0.01, medianQuality * 1.8)) continue;
    opportunities.push({
      kind: "content_breakout",
      releaseId: item.item.release_id ?? null,
      contentItemId: item.item.id,
      title: `${item.item.title} is outperforming normal content quality`,
      rationale: "This creative is producing unusually strong save/follow intent for its reach. Derive from the winner instead of starting over.",
      priority: clamp(Math.round(70 + item.qualityRate * 500), 70, 96),
      confidence: (item.funnel.views || item.funnel.reach) >= 1500 ? 0.9 : 0.75,
      evidence: { qualityRate: item.qualityRate, views: item.funnel.views, saves: item.funnel.saves, follows: item.funnel.follows },
      recommendedAction: { type: "create_derivatives", count: 3 },
      dedupeKey: `content:${item.item.id}`,
    });
  }

  for (const release of releases) {
    if (release.status !== "Scheduled" || !release.release_date) continue;
    const days = Math.ceil((utcDate(release.release_date).getTime() - now.getTime()) / DAY);
    if (days < 0 || days > 21) continue;
    const releaseContent = content.filter((item) => item.release_id === release.id && item.status !== "Archived");
    const ready = releaseContent.filter((item) => item.asset_url || ["Ready", "Scheduled", "Published"].includes(item.status)).length;
    if (releaseContent.length >= 4 && ready >= 2) continue;
    opportunities.push({
      kind: "release_risk",
      releaseId: release.id,
      title: `${release.title} has a launch-readiness risk`,
      rationale: `${days} days remain, but only ${releaseContent.length} content moments exist and ${ready} have a usable asset/readiness signal.`,
      priority: clamp(92 - days, 70, 96),
      confidence: 0.94,
      evidence: { daysUntilRelease: days, contentMoments: releaseContent.length, readyMoments: ready },
      recommendedAction: { type: "finish_release_plan", minimumContentMoments: 4 },
      dedupeKey: `risk:${release.id}`,
    });
  }

  const topCandidate = rankVaultTracks(vault, now).find((item) => item.eligible && item.score >= 70 && !item.track.linked_release_id);
  if (topCandidate) {
    opportunities.push({
      kind: "release_candidate",
      trackVaultId: topCandidate.track.id,
      title: `${topCandidate.track.title} is the strongest unreleased candidate`,
      rationale: `Portfolio score ${topCandidate.score}/100, led by ${topCandidate.reasons.join(", ")}.`,
      priority: clamp(Math.round(topCandidate.score), 70, 95),
      confidence: topCandidate.track.analysis_confidence > 0 ? Math.max(0.6, Number(topCandidate.track.analysis_confidence)) : 0.68,
      evidence: { score: topCandidate.score, components: topCandidate.components },
      recommendedAction: { type: "promote_to_release" },
      dedupeKey: `candidate:${topCandidate.track.id}`,
    });
  }

  return opportunities.sort((a, b) => b.priority - a.priority);
}

export function releasePhase(releaseDate: string | null | undefined, status: string, now = new Date()) {
  if (status === "Live") return { key: "sustain", label: "Sustain", index: 4, days: releaseDate ? Math.floor((now.getTime() - utcDate(releaseDate).getTime()) / DAY) : null };
  if (!releaseDate) return { key: "select", label: "Select", index: 0, days: null };
  const days = Math.ceil((utcDate(releaseDate).getTime() - now.getTime()) / DAY);
  if (days > 21) return { key: "prepare", label: "Prepare", index: 1, days };
  if (days > 0) return { key: "build_hype", label: "Build hype", index: 2, days };
  if (days >= -3) return { key: "release", label: "Release", index: 3, days };
  return { key: "sustain", label: "Sustain", index: 4, days };
}
