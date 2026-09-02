export type ReleaseLifecycle =
  | "development"
  | "upcoming"
  | "launch_window"
  | "catalog"
  | "archived";

type ReleaseLifecycleInput = {
  releaseDate?: string | null;
  status?: string | null;
  isArchived?: boolean | null;
};

function berlinDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function utcDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function dayDistance(from: string, to: string) {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

export function releaseLifecycle(
  release: ReleaseLifecycleInput,
  now = new Date(),
): ReleaseLifecycle {
  if (release.isArchived || release.status === "Archived") return "archived";
  if (!release.releaseDate) return release.status === "Live" ? "catalog" : "development";

  const today = berlinDateKey(now);
  const daysUntilRelease = dayDistance(today, release.releaseDate);
  if (daysUntilRelease > 0) return "upcoming";
  if (daysUntilRelease >= -14) return "launch_window";
  return "catalog";
}

export function daysSinceRelease(releaseDate: string | null | undefined, now = new Date()) {
  if (!releaseDate) return null;
  return dayDistance(releaseDate, berlinDateKey(now));
}

export function relativeDayForFutureOffset(
  releaseDate: string,
  offsetFromToday: number,
  now = new Date(),
) {
  return Math.max(0, daysSinceRelease(releaseDate, now) ?? 0) + Math.max(0, offsetFromToday);
}

export function lifecycleLabel(lifecycle: ReleaseLifecycle) {
  if (lifecycle === "development") return "In development";
  if (lifecycle === "upcoming") return "Upcoming release";
  if (lifecycle === "launch_window") return "Live · launch window";
  if (lifecycle === "catalog") return "Live catalog";
  return "Archived";
}

export function lifecyclePlanningPrinciple(lifecycle: ReleaseLifecycle) {
  if (lifecycle === "development") return "Prepare only work that does not depend on a release date.";
  if (lifecycle === "upcoming") return "Plan forward from the committed release date.";
  if (lifecycle === "launch_window") return "Never recreate missed pre-release work; continue from today and use fresh launch signal.";
  if (lifecycle === "catalog") return "Treat the track as an existing catalog asset and plan rediscovery from today, not from its historical release date.";
  return "Archived releases stay out of active planning.";
}
