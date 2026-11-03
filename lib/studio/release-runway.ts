import { dayDistance } from "@/lib/marketing/release-lifecycle";

export type RunwayRelease = {
  id: string;
  title: string;
  release_date: string | null;
  status: string;
  publish_state?: string | null;
  is_archived?: boolean | null;
};

export type RunwayMilestone = {
  kind: "preparation" | "creative" | "release";
  date: string;
  title: string;
  detail: string;
};

export type RunwayEntry = {
  id: string;
  title: string;
  date: string;
  daysUntil: number;
  spacingDays: number | null;
  spacingWarning: boolean;
  preparationWindowShort: boolean;
  milestones: RunwayMilestone[];
};

const MS_PER_DAY = 86_400_000;

function dayBefore(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - days * MS_PER_DAY).toISOString().slice(0, 10);
}

function isScheduledCandidate(release: RunwayRelease, today: string) {
  return Boolean(release.release_date
    && release.release_date >= today
    && !release.is_archived
    && release.status !== "Archived"
    && release.status !== "Live"
    && release.publish_state !== "archived"
    && release.publish_state !== "live");
}

/** Projection only. Does not create tasks, modify release dates or call any provider. */
export function buildReleaseRunway(
  releases: RunwayRelease[],
  today: string,
): RunwayEntry[] {
  const upcoming = releases.filter((release) => isScheduledCandidate(release, today))
    .sort((left, right) => String(left.release_date).localeCompare(String(right.release_date))
      || left.id.localeCompare(right.id));

  return upcoming.map((release, index) => {
    const date = release.release_date!;
    const prior = index ? upcoming[index - 1] : null;
    const next = index < upcoming.length - 1 ? upcoming[index + 1] : null;
    const before = prior ? dayDistance(prior.release_date!, date) : null;
    const after = next ? dayDistance(date, next.release_date!) : null;
    const nearest = [before, after].filter((value): value is number => value !== null)
      .reduce<number | null>((min, value) => min === null ? value : Math.min(min, value), null);
    const daysUntil = dayDistance(today, date);

    return {
      id: release.id,
      title: release.title,
      date,
      daysUntil,
      spacingDays: nearest,
      spacingWarning: nearest !== null && nearest < 21,
      preparationWindowShort: daysUntil < 21,
      milestones: [
        {
          kind: "preparation" as const,
          date: dayBefore(date, 21),
          title: "Distributor and release facts",
          detail: "Suggested internal target for verifying masters, credits, rights, artwork and delivery. Not a platform guarantee.",
        },
        {
          kind: "creative" as const,
          date: dayBefore(date, 14),
          title: "Approved promotion kit",
          detail: "Suggested target for artwork, motion, links and reviewable social assets. Actual publishing still requires approval.",
        },
        {
          kind: "release" as const,
          date,
          title: "Planned release date",
          detail: "A calendar date, not proof of accepted distributor submission or store availability.",
        },
      ],
    };
  });
}
