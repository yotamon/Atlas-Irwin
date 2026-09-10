import type { ArtistStrategy } from "@/lib/artist-operating/domain";
import type { ArtistGoalKind } from "@/types/ensemblis-database";
import type { ReleaseMissionState } from "./release-mission";

export type ArtistMissionStatus =
  | "blocked"
  | "needs_attention"
  | "planned"
  | "prepared"
  | "on_track"
  | "archived";

export type ArtistMissionNextAction = {
  title: string;
  detail: string;
  href: string;
};

export type ArtistMissionProjection = {
  kind: ArtistStrategy["recommendedMission"]["kind"];
  title: string;
  status: ArtistMissionStatus;
  label: string;
  summary: string;
  href: string;
  nextAction: ArtistMissionNextAction | null;
  source: "release" | "manager" | "strategy";
};

type MissionManagerAction = {
  action_type: string;
  title: string;
  rationale: string;
  status: string;
  payload?: unknown;
};

const GOAL_MANAGER_ACTION: Record<ArtistGoalKind, string> = {
  get_heard: "advance_discovery",
  release_music: "advance_release_strategy",
  get_gigs: "advance_gig_strategy",
  grow_fans: "advance_fan_growth",
  find_labels: "advance_label_strategy",
  build_owned_audience: "advance_owned_audience",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function preparedCount(action: MissionManagerAction) {
  const execution = record(record(action.payload).managerExecution);
  return Math.max(0, Number(execution.prepared ?? execution.synced ?? 0) || 0);
}

function releaseProjection({
  strategy,
  activeReleaseTitle,
  activeReleaseHref,
  releaseMission,
}: {
  strategy: ArtistStrategy;
  activeReleaseTitle: string | null;
  activeReleaseHref: string | null;
  releaseMission: ReleaseMissionState | null;
}): ArtistMissionProjection {
  if (!releaseMission) {
    return {
      kind: "release",
      title: strategy.recommendedMission.title,
      status: "planned",
      label: "Planned",
      summary: "No active release Mission is blocking progress. Ensemblis can prepare the next release path from the strongest ready music.",
      href: strategy.recommendedMission.href,
      nextAction: null,
      source: "strategy",
    };
  }

  return {
    kind: "release",
    title: activeReleaseTitle ? `Release ${activeReleaseTitle}` : strategy.recommendedMission.title,
    status: releaseMission.status,
    label: releaseMission.label,
    summary: releaseMission.summary,
    href: activeReleaseHref ?? strategy.recommendedMission.href,
    nextAction: releaseMission.nextAction
      ? {
          title: releaseMission.nextAction.title,
          detail: releaseMission.nextAction.detail,
          href: releaseMission.nextAction.href,
        }
      : null,
    source: "release",
  };
}

export function deriveArtistMission({
  primaryGoal,
  strategy,
  activeReleaseTitle = null,
  activeReleaseHref = null,
  releaseMission = null,
  proposedActions = [],
  completedActions = [],
}: {
  primaryGoal: ArtistGoalKind;
  strategy: ArtistStrategy;
  activeReleaseTitle?: string | null;
  activeReleaseHref?: string | null;
  releaseMission?: ReleaseMissionState | null;
  proposedActions?: MissionManagerAction[];
  completedActions?: MissionManagerAction[];
}): ArtistMissionProjection {
  if (primaryGoal === "release_music") {
    return releaseProjection({ strategy, activeReleaseTitle, activeReleaseHref, releaseMission });
  }

  const actionType = GOAL_MANAGER_ACTION[primaryGoal];
  const completed = completedActions.find((action) => action.action_type === actionType && action.status === "completed");
  const prepared = completed ? preparedCount(completed) : 0;

  if (completed && prepared > 0) {
    return {
      kind: strategy.recommendedMission.kind,
      title: strategy.recommendedMission.title,
      status: "prepared",
      label: "Prepared",
      summary: `Ensemblis prepared ${prepared} evidence-backed Growth opportunit${prepared === 1 ? "y" : "ies"} for this Mission. ${completed.rationale}`,
      href: strategy.recommendedMission.href,
      nextAction: {
        title: "Review prepared work",
        detail: completed.rationale,
        href: strategy.recommendedMission.href,
      },
      source: "manager",
    };
  }

  const proposed = proposedActions.find((action) => action.action_type === actionType && action.status === "proposed");
  if (proposed) {
    return {
      kind: strategy.recommendedMission.kind,
      title: strategy.recommendedMission.title,
      status: "planned",
      label: "Planned",
      summary: proposed.rationale,
      href: strategy.recommendedMission.href,
      nextAction: {
        title: proposed.title,
        detail: proposed.rationale,
        href: strategy.recommendedMission.href,
      },
      source: "manager",
    };
  }

  return {
    kind: strategy.recommendedMission.kind,
    title: strategy.recommendedMission.title,
    status: "planned",
    label: "Planned",
    summary: strategy.recommendedMission.rationale,
    href: strategy.recommendedMission.href,
    nextAction: null,
    source: "strategy",
  };
}
