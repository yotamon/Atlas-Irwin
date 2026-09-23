import type { ArtistGoalKind } from "@/types/ensemblis-database";
import type { Moment } from "@/types/moments-database";
import { curateReleaseMoments } from "./moments-curator";

type MomentTrackContext = {
  id: string;
  release_id: string;
  title: string;
};

type MomentReleaseContext = {
  id: string;
  title: string;
};

export type MomentMissionRecommendation = {
  id: string;
  title: string;
  detail: string;
  href: string;
  provenance: {
    momentId: string;
    sourceFingerprint: string;
    trackId: string;
    releaseId: string;
    sourceMode: Moment["source_mode"];
    sourceModes: Moment["source_mode"][];
    startMs: number;
    endMs: number;
    state: Moment["state"];
    qualityScore: number;
  };
};

function formatMomentTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function recommendationTitle(primaryGoal: ArtistGoalKind, label: string) {
  if (primaryGoal === "get_heard") return `Lead the next discovery move with “${label}”`;
  if (primaryGoal === "release_music") return `Anchor the next release move on “${label}”`;
  if (primaryGoal === "get_gigs") return `Use “${label}” as the musical proof point`;
  if (primaryGoal === "grow_fans") return `Build the next fan-facing move around “${label}”`;
  if (primaryGoal === "find_labels") return `Lead the next label-facing move with “${label}”`;
  return `Use “${label}” as the next owned-audience hook`;
}

function curateStrongestMoment(moments: Moment[]) {
  return curateReleaseMoments({ moments, maxResults: 1 }).curated[0] ?? null;
}

export function deriveMomentMissionRecommendation({
  moments,
  tracks,
  releases,
  primaryGoal,
  preferredReleaseId = null,
}: {
  moments: Moment[];
  tracks: MomentTrackContext[];
  releases: MomentReleaseContext[];
  primaryGoal: ArtistGoalKind;
  preferredReleaseId?: string | null;
}): MomentMissionRecommendation | null {
  const preferredMoments = preferredReleaseId
    ? moments.filter((moment) => moment.release_id === preferredReleaseId)
    : [];
  const moment = curateStrongestMoment(preferredMoments) ?? curateStrongestMoment(moments);
  if (!moment) return null;

  const track = tracks.find((candidate) => candidate.id === moment.track_id) ?? null;
  const release = releases.find((candidate) => candidate.id === moment.release_id) ?? null;
  const source = moment.state === "approved" ? "Artist-approved Moment" : "Track Intelligence Moment";
  const window = `${formatMomentTime(moment.start_ms)}–${formatMomentTime(moment.end_ms)}`;
  const context = [track?.title, release?.title].filter(Boolean).join(" · ");
  const purposes = (moment.purpose_tags ?? [])
    .slice(0, 3)
    .map((tag) => tag.replaceAll("_", " "));
  const purposeDetail = purposes.length ? ` Signals: ${purposes.join(", ")}.` : "";

  return {
    id: `moment-${moment.id}`,
    title: recommendationTitle(primaryGoal, moment.label),
    detail: `${source}${context ? ` from ${context}` : ""} at ${window}.${purposeDetail} Ensemblis can use this exact musical evidence instead of starting the next Mission from a generic idea.`,
    href: `/studio/music/${moment.track_id}`,
    provenance: {
      momentId: moment.id,
      sourceFingerprint: moment.source_fingerprint,
      trackId: moment.track_id,
      releaseId: moment.release_id,
      sourceMode: moment.source_mode,
      sourceModes: moment.curation.source_modes,
      startMs: moment.start_ms,
      endMs: moment.end_ms,
      state: moment.state,
      qualityScore: moment.curation.quality_score,
    },
  };
}
