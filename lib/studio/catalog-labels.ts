import type { HomepagePlacement } from "@/types/database";

export function publishStateLabel(state: string) {
  switch (state) {
    case "live":
      return "Live";
    case "scheduled":
      return "Scheduled";
    case "archived":
      return "Archived";
    default:
      return "Draft";
  }
}

export function releaseHasHomepageVisibility(release: {
  homepage_placements?: HomepagePlacement[] | null;
}) {
  return Boolean(release.homepage_placements?.some((placement) => placement.enabled));
}
