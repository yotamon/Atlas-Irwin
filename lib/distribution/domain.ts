import type { Json, Release, Track } from "@/types/database";

export const DISTRIBUTION_STATES = [
  "draft",
  "needs_attention",
  "ready",
  "submitted",
  "under_review",
  "approved",
  "delivering",
  "delivered",
  "partially_live",
  "live",
  "rejected",
  "update_pending",
  "takedown_pending",
  "taken_down",
  "error",
] as const;

export type DistributionState = (typeof DISTRIBUTION_STATES)[number];
export type DistributionIssueSeverity = "error" | "warning" | "info";
export type DistributionIssueSource = "ensemblis" | "provider" | "store";

export type DistributionIssue = {
  code: string;
  title: string;
  detail: string;
  severity: DistributionIssueSeverity;
  source: DistributionIssueSource;
  objectType?: "release" | "track" | "artist" | "rights" | "artwork" | "account";
  objectId?: string;
  storeId?: string;
  fixHref?: string;
};

export type AIInvolvement = "none" | "assisted" | "generated";
export type AIProvenance = {
  artistIdentity: "human" | "virtual" | "ai_persona";
  composition: { involvement: AIInvolvement; provider?: string };
  lyrics: { involvement: AIInvolvement; provider?: string };
  vocals: {
    involvement: "human" | "synthetic" | "mixed";
    clonedVoice: boolean;
    authorizationConfirmed?: boolean;
    provider?: string;
  };
  instrumentation: { involvement: AIInvolvement; provider?: string };
  production: { involvement: AIInvolvement; provider?: string };
};

export type DistributionRights = {
  masterRightsConfirmed: boolean;
  compositionRightsConfirmed: boolean;
  samplesCleared: boolean;
  contributorPermissionsConfirmed: boolean;
  aiDeclarationConfirmed: boolean;
  masterRightsHolder: string;
  compositionCopyrightHolder: string;
  copyrightYear: number | null;
  territories: "worldwide" | string[];
  ugc: {
    enabled: boolean;
    exclusiveMasterConfirmed: boolean;
    noUnlicensedSamplesConfirmed: boolean;
    noNonExclusiveBeatsConfirmed: boolean;
    noUnauthorizedVoicesConfirmed: boolean;
  };
};

export type DistributionDestination = {
  id: string;
  name: string;
  selected: boolean;
  category: "streaming" | "download" | "ugc";
  providerStoreId?: number;
};

export type DistributionReadiness = {
  score: number;
  ready: boolean;
  blockingCount: number;
  warningCount: number;
  checks: Array<{
    key: "audio" | "metadata" | "artwork" | "credits" | "rights" | "ai_provenance" | "artist_profiles" | "timing";
    label: string;
    status: "pass" | "warning" | "block";
    detail: string;
  }>;
  issues: DistributionIssue[];
};

const defaultAiProvenance: AIProvenance = {
  artistIdentity: "human",
  composition: { involvement: "none" },
  lyrics: { involvement: "none" },
  vocals: { involvement: "human", clonedVoice: false },
  instrumentation: { involvement: "none" },
  production: { involvement: "none" },
};

export function normalizeAiProvenance(value: Json | null | undefined): AIProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultAiProvenance;
  const raw = value as Record<string, unknown>;
  const nested = <T extends object>(key: string, fallback: T): T => {
    const candidate = raw[key];
    return candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? { ...fallback, ...(candidate as T) }
      : fallback;
  };
  return {
    ...defaultAiProvenance,
    ...(raw as Partial<AIProvenance>),
    composition: nested("composition", defaultAiProvenance.composition),
    lyrics: nested("lyrics", defaultAiProvenance.lyrics),
    vocals: nested("vocals", defaultAiProvenance.vocals),
    instrumentation: nested("instrumentation", defaultAiProvenance.instrumentation),
    production: nested("production", defaultAiProvenance.production),
  };
}

export function calculateDistributionReadiness({
  release,
  tracks,
  rights,
  aiProvenance,
  artistProfiles,
  providerIssues = [],
  creditsReady,
}: {
  release: Release;
  tracks: Track[];
  rights: DistributionRights | null;
  aiProvenance: AIProvenance;
  artistProfiles: Array<{ platform: string; external_artist_id: string | null; status: string }>;
  providerIssues?: DistributionIssue[];
  creditsReady?: { ready: boolean; detail: string; issues?: DistributionIssue[] };
}): DistributionReadiness {
  const issues: DistributionIssue[] = [...providerIssues, ...(creditsReady?.issues ?? [])];
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0];
  const audioPass = tracks.length > 0 && tracks.every((track) => Boolean(track.audio_url));
  if (!tracks.length) issues.push({ code: "tracks.missing", title: "Add at least one track", detail: "DSP delivery requires a release with at least one track.", severity: "error", source: "ensemblis", objectType: "release", objectId: release.id });
  else if (!audioPass) issues.push({ code: "audio.master_missing", title: "Add every track master", detail: "Every track needs its canonical master audio before distribution.", severity: "error", source: "ensemblis", objectType: "track", objectId: tracks.find((track) => !track.audio_url)?.id });

  const metadataPass = Boolean(release.title.trim() && release.artist?.trim() && release.genre?.trim());
  if (!metadataPass) issues.push({ code: "metadata.incomplete", title: "Complete release metadata", detail: "Artist, title and primary genre are required for distribution readiness.", severity: "error", source: "ensemblis", objectType: "release", objectId: release.id });

  const artworkPass = Boolean(release.artwork_url || release.cover_asset);
  if (!artworkPass) issues.push({ code: "artwork.missing", title: "Add cover artwork", detail: "A DSP-ready cover is required before delivery.", severity: "error", source: "ensemblis", objectType: "artwork", objectId: release.id });

  const timingPass = Boolean(release.release_date);
  if (!timingPass) issues.push({ code: "timing.release_date_missing", title: "Choose a release date", detail: "Distribution needs a canonical release date to schedule store delivery.", severity: "error", source: "ensemblis", objectType: "release", objectId: release.id });

  const declarationsPass = Boolean(rights?.masterRightsConfirmed && rights.compositionRightsConfirmed && rights.samplesCleared && rights.contributorPermissionsConfirmed && rights.aiDeclarationConfirmed);
  if (!declarationsPass) issues.push({ code: "rights.unconfirmed", title: "Confirm release rights", detail: "The artist must personally confirm master, composition, sample, contributor and AI declarations.", severity: "error", source: "ensemblis", objectType: "rights", objectId: release.id });

  const copyrightPass = Boolean(rights?.masterRightsHolder.trim() && rights.compositionCopyrightHolder.trim() && rights.copyrightYear && rights.copyrightYear >= 1900 && rights.copyrightYear <= new Date().getUTCFullYear() + 1);
  if (!copyrightPass) issues.push({ code: "rights.copyright_identity", title: "Complete copyright identity", detail: "Distribution requires the master/product rights holder, composition copyright holder and a valid copyright year.", severity: "error", source: "ensemblis", objectType: "rights", objectId: release.id });

  const ugcRightsPass = !rights?.ugc.enabled || Boolean(
    rights.ugc.exclusiveMasterConfirmed &&
    rights.ugc.noUnlicensedSamplesConfirmed &&
    rights.ugc.noNonExclusiveBeatsConfirmed &&
    rights.ugc.noUnauthorizedVoicesConfirmed
  );
  if (!ugcRightsPass) issues.push({ code: "rights.ugc_incomplete", title: "Complete UGC rights confirmation", detail: "UGC monetization needs explicit confirmation of exclusive master control, cleared samples, no non-exclusive beats and no unauthorized voices.", severity: "error", source: "ensemblis", objectType: "rights", objectId: release.id });
  const rightsPass = declarationsPass && copyrightPass && ugcRightsPass;

  const clonedVoiceNeedsAuth = aiProvenance.vocals.clonedVoice && !aiProvenance.vocals.authorizationConfirmed;
  if (clonedVoiceNeedsAuth) issues.push({ code: "ai.voice_authorization", title: "Confirm synthetic voice authorization", detail: "A cloned or replicated voice cannot be submitted until authorization is confirmed.", severity: "error", source: "ensemblis", objectType: "rights", objectId: primaryTrack?.id ?? release.id });

  const majorProfileCount = artistProfiles.filter((profile) => ["spotify", "apple_music"].includes(profile.platform) && ["confirmed", "create_new"].includes(profile.status)).length;
  const profilesStatus = majorProfileCount === 2 ? "pass" : "warning";
  if (majorProfileCount < 2) issues.push({ code: "artist_profiles.incomplete", title: "Confirm DSP artist profiles", detail: "Confirm existing Spotify and Apple Music identities, or explicitly choose new profiles, to reduce catalog mapping errors.", severity: "warning", source: "ensemblis", objectType: "artist", objectId: release.id });

  const creditsStatus = creditsReady ? (creditsReady.ready ? "pass" : "block") : "warning";
  const checks: DistributionReadiness["checks"] = [
    { key: "audio", label: "Audio", status: audioPass ? "pass" : "block", detail: audioPass ? `${tracks.length} master${tracks.length === 1 ? "" : "s"} attached` : "Master audio is incomplete" },
    { key: "metadata", label: "Metadata", status: metadataPass ? "pass" : "block", detail: metadataPass ? "Core release identity is complete" : "Artist, title or genre is missing" },
    { key: "artwork", label: "Artwork", status: artworkPass ? "pass" : "block", detail: artworkPass ? "Cover artwork is attached" : "Cover artwork is missing" },
    { key: "credits", label: "Credits", status: creditsStatus, detail: creditsReady?.detail ?? "Provider validation will verify contributor/composer requirements per DSP" },
    { key: "rights", label: "Rights", status: rightsPass ? "pass" : "block", detail: rightsPass ? "Artist declarations and copyright identity confirmed" : rights?.ugc.enabled && !ugcRightsPass ? "UGC rights declarations are incomplete" : "Legal declarations or copyright identity need confirmation" },
    { key: "ai_provenance", label: "AI provenance", status: clonedVoiceNeedsAuth ? "block" : "pass", detail: clonedVoiceNeedsAuth ? "Voice authorization is missing" : "AI involvement is explicitly modeled" },
    { key: "artist_profiles", label: "Artist profiles", status: profilesStatus, detail: majorProfileCount === 2 ? "Spotify and Apple Music mapped or explicitly new" : `${majorProfileCount}/2 major profiles resolved` },
    { key: "timing", label: "Release timing", status: timingPass ? "pass" : "block", detail: timingPass ? release.release_date! : "Release date is missing" },
  ];
  const blockingCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const passed = checks.filter((check) => check.status === "pass").length;
  const warned = checks.filter((check) => check.status === "warning").length;
  const score = Math.max(0, Math.min(100, Math.round(((passed + warned * 0.55) / checks.length) * 100)));
  return { score, ready: blockingCount === 0, blockingCount, warningCount, checks, issues };
}

export function providerStateToDistributionState(providerStatus: string | number | null | undefined): DistributionState {
  const status = String(providerStatus ?? "").trim().toLowerCase();
  if (["60", "on store", "live"].includes(status)) return "live";
  if (["50", "delivered"].includes(status)) return "delivered";
  if (["pending approval", "pending owner inspection", "inspection", "under_review"].includes(status)) return "under_review";
  if (["approved"].includes(status)) return "approved";
  if (["queued", "uploading", "processing", "delivering"].includes(status)) return "delivering";
  if (["takedown pending", "takedown_pending"].includes(status)) return "takedown_pending";
  if (["taken down", "taken_down"].includes(status)) return "taken_down";
  if (["failed", "rejected", "failed owner inspection"].includes(status)) return "rejected";
  if (["error", "100", "system error"].includes(status)) return "error";
  return "submitted";
}
