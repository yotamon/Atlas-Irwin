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
