import type { MarketingMetricSnapshot } from "@/types/marketing-database";

export const CAMPAIGN_MODES = ["suggest", "assisted", "autopilot"] as const;
export const CAMPAIGN_STATUSES = ["draft", "planned", "active", "paused", "completed", "archived"] as const;

export const MARKETING_OBJECTIVES = [
  "Reach",
  "Profile Visits",
  "Saves",
  "Follows",
  "Streams",
  "Community",
  "DJ Discovery",
  "Curator Discovery",
] as const;

export type MarketingObjective = (typeof MARKETING_OBJECTIVES)[number];

export const OBJECTIVE_KPIS: Record<MarketingObjective, { primary: string; secondary: string[] }> = {
  Reach: { primary: "qualified_reach", secondary: ["share_rate", "watch_time_per_view"] },
  "Profile Visits": { primary: "profile_visit_rate", secondary: ["share_rate", "save_rate"] },
  Saves: { primary: "save_rate", secondary: ["share_rate", "watch_time_per_view"] },
  Follows: { primary: "follow_rate", secondary: ["profile_visit_rate", "save_rate"] },
  Streams: { primary: "link_click_rate", secondary: ["streams_per_reach", "playlist_add_rate"] },
  Community: { primary: "meaningful_engagement_rate", secondary: ["comment_rate", "share_rate"] },
  "DJ Discovery": { primary: "selector_action_rate", secondary: ["share_rate", "link_click_rate"] },
  "Curator Discovery": { primary: "curator_action_rate", secondary: ["save_rate", "link_click_rate"] },
};

export const DEFAULT_PHASES = [
  { code: "discovery", name: "Discovery", objective: "Reach", start: -21, end: -10 },
  { code: "hook-test", name: "Hook testing", objective: "Saves", start: -9, end: -4 },
  { code: "anticipation", name: "Anticipation", objective: "Profile Visits", start: -3, end: -1 },
  { code: "launch", name: "Launch", objective: "Streams", start: 0, end: 2 },
  { code: "momentum", name: "Momentum", objective: "Follows", start: 3, end: 14 },
  { code: "revival", name: "Catalog revival", objective: "Streams", start: 21, end: 45 },
] as const;

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function campaignPhasePlan(anchorDate: string | null | undefined) {
  const anchor = anchorDate ? new Date(`${anchorDate}T12:00:00.000Z`) : new Date();
  return DEFAULT_PHASES.map((phase, index) => ({
    code: phase.code,
    name: phase.name,
    objective: phase.objective,
    relative_start_days: phase.start,
    relative_end_days: phase.end,
    starts_at: addUtcDays(anchor, phase.start).toISOString(),
    ends_at: addUtcDays(anchor, phase.end + 1).toISOString(),
    sort_order: index,
    status: "planned" as const,
  }));
}

export function campaignWindow(anchorDate: string | null | undefined) {
  const phases = campaignPhasePlan(anchorDate);
  return {
    startDate: phases[0]?.starts_at.slice(0, 10) ?? null,
    endDate: phases.at(-1)?.ends_at.slice(0, 10) ?? null,
  };
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function metricSignals(metric: Partial<MarketingMetricSnapshot> | Record<string, number>) {
  const reach = Number(metric.reach ?? metric.views ?? 0);
  const views = Number(metric.views ?? 0);
  const profileVisits = Number(metric.profile_visits ?? 0);
  const follows = Number(metric.follows ?? 0);
  const saves = Number(metric.saves ?? 0);
  const shares = Number(metric.shares ?? 0);
  const comments = Number(metric.comments ?? 0);
  const clicks = Number(metric.link_clicks ?? 0);
  const streams = Number(metric.streams ?? 0);
  const listeners = Number(metric.listeners ?? 0);
  const playlistAdds = Number(metric.playlist_adds ?? 0);
  const watchTime = Number(metric.watch_time ?? 0);
  return {
    reach,
    views,
    profileVisitRate: safeRate(profileVisits, reach),
    followRate: safeRate(follows, profileVisits > 0 ? profileVisits : reach),
    saveRate: safeRate(saves, reach),
    shareRate: safeRate(shares, reach),
    commentRate: safeRate(comments, reach),
    linkClickRate: safeRate(clicks, reach),
    streamsPerReach: safeRate(streams, reach),
    streamsPerClick: safeRate(streams, clicks),
    playlistAddRate: safeRate(playlistAdds, listeners > 0 ? listeners : streams),
    watchTimePerView: safeRate(watchTime, views),
    meaningfulEngagementRate: safeRate(comments + shares + saves, reach),
    selectorActionRate: safeRate(shares + saves + clicks, reach),
    curatorActionRate: safeRate(saves + clicks + playlistAdds, reach),
  };
}

export function objectivePerformanceScore(
  objective: string,
  metric: Partial<MarketingMetricSnapshot> | Record<string, number>,
) {
  const s = metricSignals(metric);
  const volume = Math.log10(1 + Math.max(s.reach, s.views)) * 8;
  switch (objective) {
    case "Profile Visits":
      return Math.round(volume + s.profileVisitRate * 1800 + s.shareRate * 500 + s.saveRate * 350);
    case "Saves":
      return Math.round(volume + s.saveRate * 2200 + s.shareRate * 650 + s.watchTimePerView * 0.04);
    case "Follows":
      return Math.round(volume + s.followRate * 2600 + s.profileVisitRate * 900 + s.saveRate * 400);
    case "Streams":
      return Math.round(volume + s.linkClickRate * 2600 + s.streamsPerReach * 2200 + s.playlistAddRate * 900);
    case "Community":
      return Math.round(volume + s.meaningfulEngagementRate * 1900 + s.commentRate * 700 + s.shareRate * 650);
    case "DJ Discovery":
      return Math.round(volume + s.selectorActionRate * 1700 + s.linkClickRate * 900 + s.shareRate * 700);
    case "Curator Discovery":
      return Math.round(volume + s.curatorActionRate * 1900 + s.playlistAddRate * 1000 + s.linkClickRate * 700);
    case "Reach":
    default:
      return Math.round(volume * 2 + s.shareRate * 800 + s.watchTimePerView * 0.06 + s.saveRate * 400);
  }
}

export function primarySignalValue(objective: string, metric: Partial<MarketingMetricSnapshot> | Record<string, number>) {
  const s = metricSignals(metric);
  switch (objective) {
    case "Profile Visits": return s.profileVisitRate;
    case "Saves": return s.saveRate;
    case "Follows": return s.followRate;
    case "Streams": return s.linkClickRate;
    case "Community": return s.meaningfulEngagementRate;
    case "DJ Discovery": return s.selectorActionRate;
    case "Curator Discovery": return s.curatorActionRate;
    case "Reach":
    default: return s.reach;
  }
}

export function aggregateMetrics<T extends Record<string, unknown>>(rows: T[]) {
  const numericKeys = [
    "reach", "views", "watch_time", "likes", "comments", "shares", "saves",
    "profile_visits", "follows", "link_clicks", "streams", "listeners", "playlist_adds",
  ] as const;
  return rows.reduce<Record<string, number>>((total, row) => {
    numericKeys.forEach((key) => {
      total[key] = (total[key] ?? 0) + (Number(row[key]) || 0);
    });
    return total;
  }, {});
}

export function formatRate(value: number) {
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}
