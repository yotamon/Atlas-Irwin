import type { Json, Release, Track } from "@/types/database";
import type {
  DistributionArtistProfile,
  DistributionReleaseMetadata,
  DistributionTrackContributor,
  DistributionTrackMetadata,
  DistributionTrackWriter,
  DistributionValidationIssue,
  ReleaseDistributionConfig,
} from "@/types/distribution-database";

export type DistributionArtistDecision = {
  key: string;
  title: string;
  detail: string;
  section: "release" | "tracks" | "credits" | "rights" | "profiles" | "delivery";
  severity: "required" | "decision" | "review";
};

export type DistributionArtistState = {
  label: string;
  tone: "neutral" | "attention" | "good" | "live";
  decisions: DistributionArtistDecision[];
  readyForApproval: boolean;
  submitted: boolean;
  live: boolean;
};

function object(value: Json | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pushUnique(target: DistributionArtistDecision[], decision: DistributionArtistDecision) {
  if (!target.some((item) => item.key === decision.key)) target.push(decision);
}

function writerShare(rows: DistributionTrackWriter[]) {
  return rows.reduce((sum, row) => sum + Number(row.share || 0), 0);
}

export function deriveDistributionArtistState(input: {
  release: Release;
  tracks: Track[];
  config: ReleaseDistributionConfig | null;
  releaseMetadata: DistributionReleaseMetadata | null;
  trackMetadata: DistributionTrackMetadata[];
  writers: DistributionTrackWriter[];
  contributors: DistributionTrackContributor[];
  artistProfiles: DistributionArtistProfile[];
  openIssues?: DistributionValidationIssue[];
}): DistributionArtistState {
  const decisions: DistributionArtistDecision[] = [];
  const meta = input.releaseMetadata;

  if (!input.release.title.trim() || !input.release.artist?.trim() || !input.release.genre?.trim()) {
    pushUnique(decisions, { key: "release.identity", title: "Complete the release identity", detail: "Title, artist and primary genre are required before delivery.", section: "release", severity: "required" });
  }
  if (!input.release.release_date) {
    pushUnique(decisions, { key: "release.date", title: "Choose the release date", detail: "Stores need the canonical release date before Ensemblis can prepare delivery.", section: "release", severity: "required" });
  }
  if (!input.release.artwork_url && !input.release.cover_asset) {
    pushUnique(decisions, { key: "release.artwork", title: "Add the final cover artwork", detail: "Use the canonical release artwork that should appear on music services.", section: "release", severity: "required" });
  }
  if (!input.release.label?.trim()) {
    pushUnique(decisions, { key: "release.label", title: "Confirm the label name", detail: "Use the imprint or self-release label name that should be delivered to stores.", section: "release", severity: "required" });
  }
  if (!meta?.product_copyright_line.trim() || !meta.recording_copyright_line.trim()) {
    pushUnique(decisions, { key: "release.copyright_lines", title: "Confirm the copyright lines", detail: "Add the product (C) and sound-recording (P) copyright identities exactly as they should be delivered.", section: "rights", severity: "required" });
  }
  if (meta?.upc_source === "artist" && !input.release.upc) {
    pushUnique(decisions, { key: "release.upc", title: "Add the release UPC", detail: "You chose to supply the UPC, so the canonical code is required before submission.", section: "release", severity: "required" });
  }

  if (!input.tracks.length) {
    pushUnique(decisions, { key: "tracks.missing", title: "Add at least one mastered track", detail: "Distribution requires a release with canonical track audio.", section: "tracks", severity: "required" });
  }

  const metadataByTrack = new Map(input.trackMetadata.map((row) => [row.track_id, row]));
  for (const track of input.tracks) {
    if (!track.audio_url) {
      pushUnique(decisions, { key: `track.${track.id}.master`, title: `Add the final master for ${track.title}`, detail: "Every delivered track needs canonical master audio.", section: "tracks", severity: "required" });
    }
    const trackMeta = metadataByTrack.get(track.id);
    if (!trackMeta) {
      pushUnique(decisions, { key: `track.${track.id}.metadata`, title: `Confirm language and explicit status for ${track.title}`, detail: "Ensemblis needs the track language, explicit flag and origin before delivery.", section: "tracks", severity: "required" });
    }
    const trackWriters = input.writers.filter((row) => row.track_id === track.id);
    if (!trackWriters.length) {
      pushUnique(decisions, { key: `track.${track.id}.writers`, title: `Add writer credits for ${track.title}`, detail: "At least one legal composer/lyricist identity is required.", section: "credits", severity: "required" });
    } else if (Math.abs(writerShare(trackWriters) - 100) > 0.01) {
      pushUnique(decisions, { key: `track.${track.id}.shares`, title: `Make ${track.title} writer shares total 100%`, detail: `Current total is ${writerShare(trackWriters).toFixed(2)}%.`, section: "credits", severity: "required" });
    }
    if (!input.contributors.some((row) => row.track_id === track.id)) {
      pushUnique(decisions, { key: `track.${track.id}.contributors`, title: `Add a production credit for ${track.title}`, detail: "Add the producer, engineer or other canonical production contributor.", section: "credits", severity: "required" });
    }
  }

  const rights = object(input.config?.rights);
  const requiredRights = ["masterRightsConfirmed", "compositionRightsConfirmed", "samplesCleared", "contributorPermissionsConfirmed", "aiDeclarationConfirmed"];
  if (!requiredRights.every((key) => rights[key] === true)) {
    pushUnique(decisions, { key: "rights.declarations", title: "Review and confirm release rights", detail: "Master, composition, samples, contributor permissions and AI provenance remain an explicit artist decision.", section: "rights", severity: "decision" });
  }

  const ai = object(input.config?.ai_provenance);
  const vocals = object(ai.vocals as Json | undefined);
  if (vocals.clonedVoice === true && vocals.authorizationConfirmed !== true) {
    pushUnique(decisions, { key: "rights.voice_authorization", title: "Confirm synthetic voice authorization", detail: "A cloned or replicated voice cannot be submitted without explicit authorization.", section: "rights", severity: "decision" });
  }

  for (const platform of ["spotify", "apple_music"] as const) {
    const profile = input.artistProfiles.find((row) => row.platform === platform);
    if (!profile || !["confirmed", "create_new"].includes(profile.status)) {
      pushUnique(decisions, { key: `profile.${platform}`, title: `Confirm the ${platform === "spotify" ? "Spotify" : "Apple Music"} artist identity`, detail: "Choose the existing artist profile or explicitly create a new one to avoid catalog mis-mapping.", section: "profiles", severity: "decision" });
    }
  }

  for (const issue of input.openIssues ?? []) {
    if (issue.severity !== "error") continue;
    if (issue.source === "ensemblis" && decisions.some((item) => issue.code.includes(item.key.split(".")[0]))) continue;
    pushUnique(decisions, { key: `issue.${issue.id}`, title: issue.title, detail: issue.detail, section: issue.source === "store" || issue.source === "provider" ? "delivery" : "release", severity: issue.source === "provider" || issue.source === "store" ? "review" : "required" });
  }

  const state = input.config?.state ?? "draft";
  const submitted = ["submitted", "under_review", "approved", "delivering", "delivered", "partially_live", "live", "update_pending", "takedown_pending"].includes(state);
  const live = state === "live";
  const actionable = decisions.filter((item) => item.severity !== "review");
  const readyForApproval = actionable.length === 0 && !submitted;

  if (live) return { label: "Live", tone: "live", decisions, readyForApproval: false, submitted: true, live: true };
  if (state === "partially_live") return { label: "Partially live", tone: "attention", decisions, readyForApproval: false, submitted: true, live: false };
  if (["rejected", "error", "needs_attention"].includes(state)) return { label: decisions.length ? `${decisions.length} item${decisions.length === 1 ? "" : "s"} need attention` : "Needs attention", tone: "attention", decisions, readyForApproval, submitted, live: false };
  if (submitted) return { label: state === "under_review" ? "Under review" : state.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), tone: "good", decisions, readyForApproval: false, submitted: true, live: false };
  if (actionable.length) return { label: `${actionable.length} decision${actionable.length === 1 ? "" : "s"} needed`, tone: "attention", decisions, readyForApproval: false, submitted: false, live: false };
  return { label: "Ready for your approval", tone: "good", decisions, readyForApproval: true, submitted: false, live: false };
}

export function canonicalDistributionMetadataSnapshot(release: Pick<Release, "label" | "upc">, meta: DistributionReleaseMetadata | null) {
  return meta ? {
    metadataLanguageCode: meta.metadata_language_code,
    labelName: release.label,
    catalogNumber: meta.catalog_number,
    productCopyrightLine: meta.product_copyright_line,
    recordingCopyrightLine: meta.recording_copyright_line,
    upcSource: meta.upc_source,
    upcStatus: meta.upc_status,
    upc: release.upc,
    originalReleaseDate: meta.original_release_date,
    preorderDate: meta.preorder_date,
  } : null;
}
