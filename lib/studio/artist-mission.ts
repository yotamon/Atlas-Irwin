import type { ArtistGoalKind } from "@/types/ensemblis-database";
import type { GrowthOpportunityKind } from "@/types/growth-database";
import type { ArtistMissionKind, ArtistOperatingProfile, ArtistStrategy } from "@/lib/artist-operating/domain";
import type { ReleaseMissionState } from "./release-mission";

export type ArtistMissionStatus = "blocked" | "needs_attention" | "in_progress" | "on_track" | "archived";

export type ArtistMissionAction = {
  title: string;
  detail: string;
  href: string;
  attention: "blocking" | "recommended" | "optional";
};

export type ArtistMissionProjection = {
  kind: ArtistMissionKind;
  title: string;
  href: string;
  status: ArtistMissionStatus;
  label: "Blocked" | "Needs attention" | "In progress" | "On track" | "Archived";
  summary: string;
  nextAction: ArtistMissionAction | null;
  evidenceCount: number;
  source: "release_state" | "artist_operating_profile";
};

type OpportunityInput = {
  id: string;
  kind: GrowthOpportunityKind;
  title: string;
  rationale: string;
  priority: number;
  status: "new" | "accepted" | "dismissed" | "completed" | "expired";
  recommended_action: unknown;
};

type ManagerActionInput = {
  actionType: string;
  status: string;
};

const GOAL_OPPORTUNITY_KINDS: Record<ArtistGoalKind, GrowthOpportunityKind[]> = {
  get_heard: ["playlist_fit", "channel_fit", "scene_fit", "catalog_revival", "content_breakout"],
  release_music: ["release_risk", "release_candidate"],
  get_gigs: ["gig_fit"],
  grow_fans: ["funnel_bottleneck", "content_breakout", "catalog_revival", "owned_audience"],
  find_labels: ["label_fit"],
  build_owned_audience: ["owned_audience"],
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

function opportunityHref(opportunity: OpportunityInput, fallback: string) {
  const action = record(opportunity.recommended_action);
  return typeof action.href === "string" && action.href.startsWith("/studio/")
    ? action.href
    : fallback;
}

function releaseProjection({
  strategy,
  releaseMission,
  releaseId,
  releaseTitle,
}: {
  strategy: ArtistStrategy;
  releaseMission: ReleaseMissionState | null;
  releaseId?: string | null;
  releaseTitle: string | null;
}): ArtistMissionProjection {
  if (!releaseMission || releaseMission.status === "archived") {
    return {
      kind: "release",
      title: strategy.recommendedMission.title,
      href: strategy.recommendedMission.href,
      status: "in_progress",
      label: "In progress",
      summary: "No active release Mission is ready yet. Ensemblis will keep the release path centered on the strongest ready music instead of manufacturing launch work.",
      nextAction: {
        title: "Choose the music for the next release",
        detail: "Start from the strongest ready track; Ensemblis can build the release Mission from canonical music state after that.",
        href: "/studio/music",
        attention: "recommended",
      },
      evidenceCount: 0,
      source: "artist_operating_profile",
    };
  }

  return {
    kind: "release",
    title: releaseTitle ? `Release ${releaseTitle}` : strategy.recommendedMission.title,
    href: releaseId ? `/studio/releases/${releaseId}` : releaseMission.nextAction?.href ?? "/studio/releases",
    status: releaseMission.status,
    label: releaseMission.label,
    summary: releaseMission.summary,
    nextAction: releaseMission.nextAction,
    evidenceCount: releaseMission.blockers.length + releaseMission.recommendations.length + releaseMission.optional.length,
    source: "release_state",
  };
}

export function deriveArtistMission({
  profile,
  strategy,
  releaseMission,
  releaseId,
  releaseTitle,
  opportunities,
  managerActions,
}: {
  profile: ArtistOperatingProfile;
  strategy: ArtistStrategy;
  releaseMission: ReleaseMissionState | null;
  releaseId?: string | null;
  releaseTitle: string | null;
  opportunities: OpportunityInput[];
  managerActions: ManagerActionInput[];
}): ArtistMissionProjection {
  if (profile.primaryGoal === "release_music") {
    return releaseProjection({ strategy, releaseMission, releaseId, releaseTitle });
  }

  const relevantKinds = new Set(GOAL_OPPORTUNITY_KINDS[profile.primaryGoal]);
  const relevant = opportunities
    .filter((opportunity) => relevantKinds.has(opportunity.kind) && ["new", "accepted"].includes(opportunity.status))
    .sort((left, right) => right.priority - left.priority);
  const top = relevant[0] ?? null;
  const managerActionType = GOAL_MANAGER_ACTION[profile.primaryGoal];
  const managerAction = managerActions.find((action) => action.actionType === managerActionType) ?? null;
  const acceptedCount = relevant.filter((opportunity) => opportunity.status === "accepted").length;

  if (top) {
    return {
      kind: strategy.recommendedMission.kind,
      title: strategy.recommendedMission.title,
      href: strategy.recommendedMission.href,
      status: "on_track",
      label: "On track",
      summary: acceptedCount > 0
        ? `${acceptedCount} evidence-backed opportunit${acceptedCount === 1 ? "y is" : "ies are"} already accepted inside this Mission; Ensemblis can keep preparing the next move from real artist evidence.`
        : `Ensemblis has ${relevant.length} evidence-backed opportunit${relevant.length === 1 ? "y" : "ies"} supporting this Mission. The strongest current opportunity is “${top.title}”.`,
      nextAction: {
        title: top.title,
        detail: top.rationale,
        href: opportunityHref(top, strategy.recommendedMission.href),
        attention: "recommended",
      },
      evidenceCount: relevant.length,
      source: "artist_operating_profile",
    };
  }

  if (managerAction) {
    const prepared = managerAction.status === "completed";
    return {
      kind: strategy.recommendedMission.kind,
      title: strategy.recommendedMission.title,
      href: strategy.recommendedMission.href,
      status: "in_progress",
      label: "In progress",
      summary: prepared
        ? "Ensemblis recently prepared this Mission from the available evidence and is waiting for the next measurable signal before manufacturing more work."
        : "Ensemblis is preparing the next evidence-backed move for this Mission. No artist decision is required just to keep the internal work moving.",
      nextAction: null,
      evidenceCount: 0,
      source: "artist_operating_profile",
    };
  }

  return {
    kind: strategy.recommendedMission.kind,
    title: strategy.recommendedMission.title,
    href: strategy.recommendedMission.href,
    status: "in_progress",
    label: "In progress",
    summary: "Ensemblis is watching the artist’s current music, audience and scene evidence and will prepare the next move when there is enough support to act without guessing.",
    nextAction: null,
    evidenceCount: 0,
    source: "artist_operating_profile",
  };
}
