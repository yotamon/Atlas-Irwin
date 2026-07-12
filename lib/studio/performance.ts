export const DEFAULT_PERFORMANCE_WEIGHTS = {
  profile_visits: 8,
  follows: 10,
  saves: 8,
  link_clicks: 6,
  shares: 5,
  watch_time: 0.02,
  likes: 1,
  views: 0.05,
} as const;

export const PULSE_METRICS = [
  ["streams", "Plays"],
  ["saves", "Saves"],
  ["follows", "Follows"],
  ["profile_visits", "Profile visits"],
  ["link_clicks", "Link clicks"],
  ["views", "Content views"],
] as const;

export type PulseMetricKey = (typeof PULSE_METRICS)[number][0];

export function contentPerformanceScore(
  metric: Record<string, number>,
  weights: Record<string, number> = DEFAULT_PERFORMANCE_WEIGHTS,
) {
  return Math.round(
    Object.entries(weights).reduce(
      (score, [key, weight]) => score + (metric[key] ?? 0) * weight,
      0,
    ),
  );
}

export function metricTotal<T extends Record<PulseMetricKey, number>>(
  rows: T[],
  key: PulseMetricKey,
) {
  return rows.reduce((sum, row) => sum + (row[key] ?? 0), 0);
}

export function seriesByDate<T extends { date: string } & Record<PulseMetricKey, number>>(
  rows: T[],
  key: PulseMetricKey,
  days = 14,
) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    buckets.set(day.toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    if (!buckets.has(row.date)) continue;
    buckets.set(row.date, (buckets.get(row.date) ?? 0) + (row[key] ?? 0));
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value }));
}

export function conversionPercent(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "New this week" : "No change";
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta > 0 ? "+" : ""}${delta}% vs last week`;
}
