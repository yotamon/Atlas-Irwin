import type { ReleaseLifecycle } from "@/lib/marketing/release-lifecycle";

export type MissionAttention = "blocking" | "recommended" | "optional";

export type ReleaseMissionItem = {
  key: string;
  title: string;
  detail: string;
  href: string;
  attention: MissionAttention;
};

export type ReleaseMissionState = {
  status: "blocked" | "needs_attention" | "on_track" | "archived";
  label: "Blocked" | "Needs attention" | "On track" | "Archived";
  summary: string;
  blockers: ReleaseMissionItem[];
  recommendations: ReleaseMissionItem[];
  optional: ReleaseMissionItem[];
  nextAction: ReleaseMissionItem | null;
};

export type ReleaseMissionInput = {
  releaseId: string;
  lifecycle: ReleaseLifecycle;
  releaseDate: string | null;
  hasMasterAudio: boolean;
  hasArtwork: boolean;
  hasCampaign: boolean;
  missingAssetTitles: string[];
  hasListeningDestination: boolean;
  hasPrimaryHook: boolean;
  providerScheduledCount?: number;
};

function item(
  key: string,
  title: string,
  detail: string,
  href: string,
  attention: MissionAttention,
): ReleaseMissionItem {
  return { key, title, detail, href, attention };
}

export function deriveReleaseMission(input: ReleaseMissionInput): ReleaseMissionState {
  const blockers: ReleaseMissionItem[] = [];
  const recommendations: ReleaseMissionItem[] = [];
  const optional: ReleaseMissionItem[] = [];
  const releaseHref = `/studio/releases/${input.releaseId}`;

  if (input.lifecycle === "archived") {
    return {
      status: "archived",
      label: "Archived",
      summary: "This release is archived, so Ensemblis is not manufacturing active Mission work for it.",
      blockers,
      recommendations,
      optional,
      nextAction: null,
    };
  }

  if (!input.hasMasterAudio) {
    blockers.push(item(
      "master",
      "Add the canonical master",
      "Ensemblis cannot reliably analyze, create from, or prepare distribution for this release without the actual master.",
      `${releaseHref}#master-audio`,
      "blocking",
    ));
  }

  if (!input.releaseDate && input.lifecycle !== "catalog") {
    blockers.push(item(
      "release-date",
      "Choose the release date",
      "The release date anchors lifecycle planning, distribution timing and campaign scheduling.",
      `${releaseHref}#release-details`,
      "blocking",
    ));
  }

  if (!input.hasArtwork) {
    recommendations.push(item(
      "artwork",
      "Add release artwork",
      "Artwork becomes a release identity anchor for distribution, Sites and generated campaign creative.",
      `${releaseHref}#cover-upload`,
      "recommended",
    ));
  }

  if (!input.hasCampaign) {
    recommendations.push(item(
      "campaign",
      "Campaign engine needs repair",
      "Ensemblis normally prepares the campaign shell automatically. Inspect Campaign Brain only if self-healing cannot restore it.",
      "/studio/campaigns",
      "recommended",
    ));
  }

  for (const title of input.missingAssetTitles.slice(0, 3)) {
    recommendations.push(item(
      `asset:${title}`,
      `Finish ${title}`,
      "A future campaign moment is scheduled but still needs its creative asset.",
      "/studio/production",
      "recommended",
    ));
  }

  if (!input.hasListeningDestination && input.lifecycle === "catalog") {
    recommendations.push(item(
      "destination",
      "Connect a listening destination",
      "Catalog growth needs at least one reliable place to send listeners.",
      `${releaseHref}?view=advanced&tab=music`,
      "recommended",
    ));
  }

  if (!input.hasPrimaryHook && input.hasMasterAudio) {
    optional.push(item(
      "hook",
      "Review the strongest musical Moment",
      "A reviewed hook gives creative and campaign work a stronger artist-approved starting point.",
      `${releaseHref}?stage=create#moments`,
      "optional",
    ));
  }

  if ((input.providerScheduledCount ?? 0) > 0) {
    optional.push(item(
      "provider-lock",
      "External publishing schedule is active",
      `${input.providerScheduledCount} publication${input.providerScheduledCount === 1 ? " is" : "s are"} already scheduled at a provider. Ensemblis will protect that approved timing from drift.`,
      `${releaseHref}?stage=publish`,
      "optional",
    ));
  }

  const nextAction = blockers[0] ?? recommendations[0] ?? optional[0] ?? null;
  if (blockers.length) {
    return {
      status: "blocked",
      label: "Blocked",
      summary: `${blockers.length} required item${blockers.length === 1 ? " is" : "s are"} blocking this release mission.`,
      blockers,
      recommendations,
      optional,
      nextAction,
    };
  }

  if (recommendations.length) {
    return {
      status: "needs_attention",
      label: "Needs attention",
      summary: `${recommendations.length} useful next step${recommendations.length === 1 ? " is" : "s are"} left; Ensemblis can keep the rest moving.`,
      blockers,
      recommendations,
      optional,
      nextAction,
    };
  }

  return {
    status: "on_track",
    label: "On track",
    summary: "No required release decision is blocking progress right now.",
    blockers,
    recommendations,
    optional,
    nextAction,
  };
}
