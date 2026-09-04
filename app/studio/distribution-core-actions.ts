"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  calculateDistributionReadiness,
  normalizeAiProvenance,
  providerStateToDistributionState,
  type AIProvenance,
  type DistributionIssue,
  type DistributionRights,
  type DistributionState,
} from "@/lib/distribution/domain";
import {
  distributionProviderConfigured,
  getDistributionProvider,
  type DistributionProvider,
  type ProviderCatalogRelease,
  type ProviderStore,
} from "@/lib/distribution/provider";
import type { Json, Release, Track } from "@/types/database";
import type {
  DistributionAccount,
  DistributionArtistProfile,
  DistributionDatabase,
  DistributionTrackContributor,
  DistributionTrackMetadata,
  DistributionTrackWriter,
  ReleaseDistributionConfig,
} from "@/types/distribution-database";

type DistributionDb = SupabaseClient<DistributionDatabase>;

type DistributionContext = {
  db: DistributionDb;
  userId: string;
  release: Release;
  tracks: Track[];
  config: ReleaseDistributionConfig | null;
  account: DistributionAccount | null;
  artistProfiles: DistributionArtistProfile[];
  trackMetadata: DistributionTrackMetadata[];
  writers: DistributionTrackWriter[];
  contributors: DistributionTrackContributor[];
};

function bool(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function optionalText(form: FormData, key: string) {
  const value = text(form, key);
  return value || undefined;
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function issueFingerprint(issue: DistributionIssue) {
  return createHash("sha256")
    .update([issue.code, issue.source, issue.storeId ?? "", issue.objectType ?? "", issue.objectId ?? "", issue.detail].join("|"))
    .digest("hex");
}

function todayBerlin() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function filenameFromUrl(url: string, fallback: string) {
  try {
    const filename = new URL(url).pathname.split("/").pop()?.trim();
    return filename || fallback;
  } catch {
    return fallback;
  }
}

function parseRights(value: Json | null | undefined): DistributionRights | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = object(value);
  const ugcRaw = object(raw.ugc as Json | undefined);
  const year = Number(raw.copyrightYear);
  return {
    masterRightsConfirmed: raw.masterRightsConfirmed === true,
    compositionRightsConfirmed: raw.compositionRightsConfirmed === true,
    samplesCleared: raw.samplesCleared === true,
    contributorPermissionsConfirmed: raw.contributorPermissionsConfirmed === true,
    aiDeclarationConfirmed: raw.aiDeclarationConfirmed === true,
    productCopyrightHolder: String(raw.productCopyrightHolder ?? "").trim(),
    recordingCopyrightHolder: String(raw.recordingCopyrightHolder ?? "").trim(),
    copyrightYear: Number.isFinite(year) ? year : null,
    territories: raw.territories === "worldwide" || Array.isArray(raw.territories) ? raw.territories as "worldwide" | string[] : "worldwide",
    ugc: {
      enabled: ugcRaw.enabled === true,
      exclusiveMasterConfirmed: ugcRaw.exclusiveMasterConfirmed === true,
      noUnlicensedSamplesConfirmed: ugcRaw.noUnlicensedSamplesConfirmed === true,
      noNonExclusiveBeatsConfirmed: ugcRaw.noNonExclusiveBeatsConfirmed === true,
      noUnauthorizedVoicesConfirmed: ugcRaw.noUnauthorizedVoicesConfirmed === true,
    },
  };
}

function parseDestinationConfig(value: Json | null | undefined) {
  const raw = object(value);
  const mode = raw.mode === "custom" ? "custom" as const : "all_enabled" as const;
  const storeIds = Array.isArray(raw.storeIds)
    ? [...new Set(raw.storeIds.map(Number).filter(Number.isFinite))]
    : [];
  return { mode, storeIds };
}

async function loadContext(releaseId: string): Promise<DistributionContext> {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as DistributionDb;
  const [releaseResult, tracksResult, configResult, accountResult, profilesResult, metadataResult, writersResult, contributorsResult] = await Promise.all([
    db.from("releases").select("*").eq("id", releaseId).eq("owner_id", user.id).single(),
    db.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").maybeSingle(),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id),
  ]);
  for (const result of [releaseResult, tracksResult, configResult, accountResult, profilesResult, metadataResult, writersResult, contributorsResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!releaseResult.data) throw new Error("Release not found or unauthorized.");
  const tracks = tracksResult.data ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  return {
    db,
    userId: user.id,
    release: releaseResult.data,
    tracks,
    config: configResult.data,
    account: accountResult.data,
    artistProfiles: (profilesResult.data ?? []).filter((profile) => profile.artist_name === releaseResult.data.artist),
    trackMetadata: (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    writers: (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    contributors: (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
  };
}

function assertTrack(context: DistributionContext, trackId: string) {
  const track = context.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error("Track not found or unauthorized.");
  return track;
}

function creditsReadiness(context: DistributionContext) {
  const issues: DistributionIssue[] = [];
  const metadataByTrack = new Map(context.trackMetadata.map((row) => [row.track_id, row]));
  for (const track of context.tracks) {
    const metadata = metadataByTrack.get(track.id);
    if (!metadata) {
      issues.push({ code: "credits.track_metadata", title: `Complete distribution metadata for ${track.title}`, detail: "Choose language, explicit status and track origin before provider preparation.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    } else if (metadata.isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(metadata.isrc.toUpperCase())) {
      issues.push({ code: "credits.isrc_invalid", title: `Check the ISRC for ${track.title}`, detail: "ISRC must use the 12-character CCXXXYYNNNNN format, or be left blank for provider assignment.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    const writers = context.writers.filter((row) => row.track_id === track.id);
    if (!writers.length) {
      issues.push({ code: "credits.writer_missing", title: `Add writer credits for ${track.title}`, detail: "At least one legal composer/lyricist identity is required for distribution.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    } else {
      const share = writers.reduce((sum, writer) => sum + Number(writer.share), 0);
      if (Math.abs(share - 100) > 0.01) issues.push({ code: "credits.writer_share", title: `Writer shares for ${track.title} must total 100%`, detail: `Current total is ${share.toFixed(2)}%.`, severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
      if (writers.some((writer) => writer.publishing_type === "published" && !writer.publisher_name?.trim())) issues.push({ code: "credits.publisher_missing", title: `Add publisher details for ${track.title}`, detail: "Published writers need a publisher name.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    const contributors = context.contributors.filter((row) => row.track_id === track.id);
    if (!contributors.length) issues.push({ code: "credits.production_missing", title: `Add production credit for ${track.title}`, detail: "At least one production or engineering contributor is required before provider preparation.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    if (track.audio_url) {
      const extension = filenameFromUrl(track.audio_url, "").toLowerCase().split(".").pop();
      if (extension !== "wav" && extension !== "flac") issues.push({ code: "audio.lossless_required", title: `Use a lossless master for ${track.title}`, detail: "Distribution catalog preparation requires a WAV or FLAC master.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
  }
  return {
    ready: issues.length === 0,
    detail: issues.length ? `${issues.length} catalog credit/track issue${issues.length === 1 ? "" : "s"} remain` : "Track metadata, writers and production credits are complete",
    issues,
  };
}

async function requireDistributionAccountReady(context: DistributionContext) {
  const account = context.account;
  if (!account?.agreement_accepted_at || !account.rights_terms_accepted_at) throw new Error("Complete distribution onboarding and accept the distribution terms before continuing.");
  if (["setup_required", "restricted", "suspended"].includes(account.status)) throw new Error("This distribution account is not currently eligible to submit releases. Resolve the account status first.");
}

async function resolveStoreSelection(config: ReleaseDistributionConfig | null, provider: DistributionProvider) {
  const available = (await provider.listStores()).filter((store) => store.active);
  const destination = parseDestinationConfig(config?.destinations);
  const allowedIds = new Set(available.map((store) => store.id));
  const selected = destination.mode === "custom" ? destination.storeIds.filter((id) => allowedIds.has(id)) : available.map((store) => store.id);
  return { available, selected };
}

function providerSetupIssues(config: ReleaseDistributionConfig | null): DistributionIssue[] {
  const issues: DistributionIssue[] = [];
  if (!config?.provider_release_id) issues.push({ code: "provider.release_not_prepared", title: "Distribution package has not been prepared", detail: "Prepare the provider catalog package before final preflight.", severity: "error", source: "provider", objectType: "release", objectId: config?.release_id });
  if (!distributionProviderConfigured()) issues.push({ code: "provider.credentials_unavailable", title: "Distribution provider is not connected", detail: "Distribution provider credentials must be configured on the server before Ensemblis can validate or deliver releases.", severity: "error", source: "provider", objectType: "account" });
  return issues;
}

async function persistIssues(db: DistributionDb, userId: string, releaseId: string, issues: DistributionIssue[]) {
  const now = new Date().toISOString();
  const stale = await db.from("distribution_validation_issues").update({ status: "resolved", resolved_at: now, updated_at: now }).eq("owner_id", userId).eq("release_id", releaseId).in("status", ["open", "acknowledged"]);
  if (stale.error) throw new Error(stale.error.message);
  if (!issues.length) return;
  const rows = issues.map((issue) => ({
    owner_id: userId,
    release_id: releaseId,
    fingerprint: issueFingerprint(issue),
    code: issue.code,
    title: issue.title,
    detail: issue.detail,
    severity: issue.severity,
    source: issue.source,
    object_type: issue.objectType ?? null,
    object_id: issue.objectId ?? null,
    store_id: issue.storeId ?? null,
    status: "open" as const,
    raw_issue: json(issue),
    last_seen_at: now,
    resolved_at: null,
    updated_at: now,
  }));
  const result = await db.from("distribution_validation_issues").upsert(rows, { onConflict: "release_id,fingerprint" });
  if (result.error) throw new Error(result.error.message);
}

async function validateContext(context: DistributionContext) {
  let providerIssues = providerSetupIssues(context.config);
  let stores: ProviderStore[] = [];
  let selectedStoreIds: number[] = [];
  let providerSnapshot: unknown = null;
  if (context.config?.provider_release_id && distributionProviderConfigured()) {
    try {
      const provider = getDistributionProvider();
      const selection = await resolveStoreSelection(context.config, provider);
      stores = selection.available;
      selectedStoreIds = selection.selected;
      if (!selectedStoreIds.length) providerIssues.push({ code: "provider.no_stores_selected", title: "Choose at least one music service", detail: "No active provider stores are currently selected for this release.", severity: "error", source: "provider", objectType: "release", objectId: context.release.id });
      else {
        const validation = await provider.validateRelease(context.config.provider_release_id, selectedStoreIds);
        providerIssues = providerIssues.concat(validation.issues);
        providerSnapshot = validation.raw;
      }
    } catch (error) {
      providerIssues.push({ code: "provider.validation_unavailable", title: "Provider validation could not complete", detail: error instanceof Error ? error.message : "The provider validation request failed.", severity: "error", source: "provider", objectType: "release", objectId: context.release.id });
    }
  }
  const readiness = calculateDistributionReadiness({ release: context.release, tracks: context.tracks, rights: parseRights(context.config?.rights), aiProvenance: normalizeAiProvenance(context.config?.ai_provenance), artistProfiles: context.artistProfiles, providerIssues, creditsReady: creditsReadiness(context) });
  return { readiness, stores, selectedStoreIds, providerSnapshot };
}

async function logEvent(db: DistributionDb, input: { ownerId: string; releaseId?: string; submissionId?: string; eventType: string; actorType?: "artist" | "operator" | "system" | "provider"; provider?: string; payload?: Json }) {
  const result = await db.from("distribution_events").insert({ owner_id: input.ownerId, release_id: input.releaseId ?? null, submission_id: input.submissionId ?? null, event_type: input.eventType, actor_type: input.actorType ?? "system", provider: input.provider ?? null, payload: input.payload ?? {} });
  if (result.error) throw new Error(result.error.message);
}

function refreshDistributionRoutes(releaseId?: string) {
  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  if (releaseId) {
    revalidatePath(`/studio/releases/${releaseId}`);
    revalidatePath(`/studio/releases/${releaseId}/distribution`);
  }
}

function aiIncludesGeneratedMaterial(ai: AIProvenance) {
  return ai.artistIdentity === "ai_persona" || ai.composition.involvement !== "none" || ai.lyrics.involvement !== "none" || ai.vocals.involvement !== "human" || ai.instrumentation.involvement !== "none" || ai.production.involvement !== "none";
}

function providerErrorStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
}

function catalogInput(context: DistributionContext): ProviderCatalogRelease {
  const rights = parseRights(context.config?.rights);
  const ai = normalizeAiProvenance(context.config?.ai_provenance);
  const credits = creditsReadiness(context);
  if (!credits.ready) throw new Error("Complete track metadata, writer shares and production credits before preparing the catalog package.");
  if (!rights?.productCopyrightHolder || !rights.recordingCopyrightHolder || !rights.copyrightYear) throw new Error("Complete product and recording copyright details before preparing the catalog package.");
  if (!context.release.genre || !context.release.release_date || !context.release.artwork_url) throw new Error("Release genre, date and fetchable artwork are required before provider preparation.");
  const metadataByTrack = new Map(context.trackMetadata.map((row) => [row.track_id, row]));
  const previous = context.release.release_date < todayBerlin();
  if (previous && !context.release.upc) throw new Error("Previously released catalog needs its existing UPC before provider preparation. Never mint a new UPC for an existing release.");
  return {
    title: context.release.title,
    artistName: context.release.artist,
    genre: context.release.genre,
    label: context.release.label,
    upc: context.release.upc,
    previouslyReleased: previous,
    originalReleaseDate: previous ? context.release.release_date : null,
    releaseDate: previous ? todayBerlin() : context.release.release_date,
    metadataLanguageCode: context.trackMetadata[0]?.metadata_language_code ?? "en",
    copyrightYear: rights.copyrightYear,
    productCopyrightHolder: rights.productCopyrightHolder,
    recordingCopyrightHolder: rights.recordingCopyrightHolder,
    artworkUrl: context.release.artwork_url,
    artworkFilename: filenameFromUrl(context.release.artwork_url, `${context.release.slug || "cover"}.jpg`),
    artistProfiles: context.artistProfiles.filter((profile) => ["spotify", "apple_music", "soundcloud"].includes(profile.platform)).map((profile) => ({ platform: profile.platform, externalArtistId: profile.status === "confirmed" ? profile.external_artist_id : null })),
    tracks: context.tracks.map((track) => {
      const metadata = metadataByTrack.get(track.id);
      if (!metadata || !track.audio_url) throw new Error(`Track '${track.title}' is missing distribution metadata or its master audio.`);
      return {
        title: track.title,
        version: track.version,
        artistName: context.release.artist,
        audioUrl: track.audio_url,
        audioFilename: filenameFromUrl(track.audio_url, `${track.title}.wav`),
        metadataLanguageCode: metadata.metadata_language_code,
        audioLanguageCode: metadata.audio_language_code,
        explicit: metadata.explicit,
        origin: metadata.track_origin,
        isrc: metadata.isrc,
        includesAi: aiIncludesGeneratedMaterial(ai),
        writers: context.writers.filter((writer) => writer.track_id === track.id).map((writer) => ({ legalName: writer.legal_name, role: writer.role, share: Number(writer.share), publishingType: writer.publishing_type, publisherName: writer.publisher_name })),
        contributors: context.contributors.filter((contributor) => contributor.track_id === track.id).map((contributor) => ({ name: contributor.name, role: contributor.role })),
      };
    }),
  };
}

export async function saveDistributionAccount(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as DistributionDb;
  const legalName = text(form, "legal_name");
  const countryCode = text(form, "country_code").toUpperCase();
  if (!legalName || !/^[A-Z]{2}$/.test(countryCode)) throw new Error("Legal name and a two-letter country code are required.");
  if (!bool(form, "agreement_accepted") || !bool(form, "rights_terms_accepted")) throw new Error("Distribution and rights terms must be explicitly accepted.");
  const now = new Date().toISOString();
  const result = await db.from("distribution_accounts").upsert({ owner_id: user.id, provider: "revelator", legal_name: legalName, country_code: countryCode, agreement_accepted_at: now, rights_terms_accepted_at: now, status: "pending_verification", kyc_status: "pending", payout_status: "pending" }, { onConflict: "owner_id,provider" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(db, { ownerId: user.id, eventType: "distribution.account_terms_confirmed", actorType: "artist", provider: "revelator", payload: { countryCode } });
  refreshDistributionRoutes();
}

export async function saveDistributionDeclarations(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  if (context.config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state)) throw new Error("Distribution declarations are locked after submission.");
  const ugcEnabled = bool(form, "ugc_enabled");
  const year = Number(text(form, "copyright_year"));
  const rights: DistributionRights = {
    masterRightsConfirmed: bool(form, "master_rights_confirmed"), compositionRightsConfirmed: bool(form, "composition_rights_confirmed"), samplesCleared: bool(form, "samples_cleared"), contributorPermissionsConfirmed: bool(form, "contributor_permissions_confirmed"), aiDeclarationConfirmed: bool(form, "ai_declaration_confirmed"),
    productCopyrightHolder: text(form, "product_copyright_holder"), recordingCopyrightHolder: text(form, "recording_copyright_holder"), copyrightYear: Number.isFinite(year) ? year : null, territories: "worldwide",
    ugc: { enabled: ugcEnabled, exclusiveMasterConfirmed: ugcEnabled ? bool(form, "ugc_exclusive_master_confirmed") : false, noUnlicensedSamplesConfirmed: ugcEnabled ? bool(form, "ugc_no_unlicensed_samples_confirmed") : false, noNonExclusiveBeatsConfirmed: ugcEnabled ? bool(form, "ugc_no_nonexclusive_beats_confirmed") : false, noUnauthorizedVoicesConfirmed: ugcEnabled ? bool(form, "ugc_no_unauthorized_voices_confirmed") : false },
  };
  const aiProvenance: AIProvenance = {
    artistIdentity: ["human", "virtual", "ai_persona"].includes(text(form, "artist_identity")) ? text(form, "artist_identity") as AIProvenance["artistIdentity"] : "human",
    composition: { involvement: ["none", "assisted", "generated"].includes(text(form, "composition_ai")) ? text(form, "composition_ai") as AIProvenance["composition"]["involvement"] : "none", provider: optionalText(form, "composition_provider") },
    lyrics: { involvement: ["none", "assisted", "generated"].includes(text(form, "lyrics_ai")) ? text(form, "lyrics_ai") as AIProvenance["lyrics"]["involvement"] : "none", provider: optionalText(form, "lyrics_provider") },
    vocals: { involvement: ["human", "synthetic", "mixed"].includes(text(form, "vocals_ai")) ? text(form, "vocals_ai") as AIProvenance["vocals"]["involvement"] : "human", clonedVoice: bool(form, "cloned_voice"), authorizationConfirmed: bool(form, "voice_authorization_confirmed"), provider: optionalText(form, "vocals_provider") },
    instrumentation: { involvement: ["none", "assisted", "generated"].includes(text(form, "instrumentation_ai")) ? text(form, "instrumentation_ai") as AIProvenance["instrumentation"]["involvement"] : "none", provider: optionalText(form, "instrumentation_provider") },
    production: { involvement: ["none", "assisted", "generated"].includes(text(form, "production_ai")) ? text(form, "production_ai") as AIProvenance["production"]["involvement"] : "none", provider: optionalText(form, "production_provider") },
  };
  const destinationMode = text(form, "destination_mode") === "custom" ? "custom" : "all_enabled";
  const storeIds = form.getAll("store_id").map(Number).filter(Number.isFinite);
  const result = await context.db.from("release_distribution_configs").upsert({ release_id: releaseId, owner_id: context.userId, provider: context.config?.provider ?? "revelator", provider_release_id: context.config?.provider_release_id ?? null, state: context.config?.state && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state) ? context.config.state : "draft", destinations: json({ mode: destinationMode, storeIds }), territories: json({ mode: "worldwide", countries: [] }), rights: json(rights), ai_provenance: json(aiProvenance), provider_metadata: context.config?.provider_metadata ?? {}, readiness_score: 0, last_validated_at: null }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.declarations_saved", actorType: "artist", provider: context.config?.provider ?? "revelator", payload: { destinationMode, storeCount: storeIds.length, ugcEnabled } });
  refreshDistributionRoutes(releaseId);
}

export async function saveDistributionArtistProfile(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const platform = text(form, "platform").toLowerCase();
  if (!["spotify", "apple_music", "amazon_music", "youtube_music", "soundcloud"].includes(platform)) throw new Error("Unsupported artist profile platform.");
  const externalArtistId = text(form, "external_artist_id");
  const externalUrl = text(form, "external_url");
  const createNew = bool(form, "create_new");
  if (!createNew && !externalArtistId) throw new Error("Choose an existing artist profile or explicitly mark this as a new profile.");
  const result = await context.db.from("distribution_artist_profiles").upsert({ owner_id: context.userId, artist_name: context.release.artist, platform, external_artist_id: createNew ? null : externalArtistId, external_url: createNew ? null : externalUrl || null, status: createNew ? "create_new" : "confirmed", confirmed_at: new Date().toISOString() }, { onConflict: "owner_id,artist_name,platform" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.artist_profile_confirmed", actorType: "artist", payload: { platform, createNew } });
  refreshDistributionRoutes(releaseId);
}

export async function saveDistributionTrackMetadata(form: FormData) {
  const releaseId = text(form, "release_id");
  const trackId = text(form, "track_id");
  const context = await loadContext(releaseId);
  assertTrack(context, trackId);
  const origin = text(form, "track_origin");
  const isrc = text(form, "isrc").toUpperCase();
  if (!["original", "cover", "public_domain"].includes(origin)) throw new Error("Choose whether the track is original, a cover or public domain.");
  if (isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) throw new Error("ISRC format is invalid. Leave it blank if Ensemblis should let the provider assign one.");
  const result = await context.db.from("distribution_track_metadata").upsert({ track_id: trackId, owner_id: context.userId, metadata_language_code: text(form, "metadata_language_code") || "en", audio_language_code: text(form, "audio_language_code") || "en", explicit: bool(form, "explicit"), track_origin: origin as DistributionTrackMetadata["track_origin"], isrc: isrc || null }, { onConflict: "track_id" });
  if (result.error) throw new Error(result.error.message);
  refreshDistributionRoutes(releaseId);
}

export async function addDistributionTrackWriter(form: FormData) {
  const releaseId = text(form, "release_id");
  const trackId = text(form, "track_id");
  const context = await loadContext(releaseId);
  assertTrack(context, trackId);
  const legalName = text(form, "legal_name");
  const role = text(form, "role");
  const publishingType = text(form, "publishing_type");
  const share = Number(text(form, "share"));
  const publisherName = text(form, "publisher_name");
  if (!legalName || !["composer", "lyricist", "composer_lyricist"].includes(role) || !["copyright_control", "published", "public_domain"].includes(publishingType) || !Number.isFinite(share) || share <= 0 || share > 100) throw new Error("Writer name, role, publishing type and a share between 0 and 100 are required.");
  if (publishingType === "published" && !publisherName) throw new Error("Publisher name is required for a published writer.");
  const result = await context.db.from("distribution_track_writers").insert({ owner_id: context.userId, track_id: trackId, legal_name: legalName, role: role as DistributionTrackWriter["role"], share, publishing_type: publishingType as DistributionTrackWriter["publishing_type"], publisher_name: publisherName || null });
  if (result.error) throw new Error(result.error.message);
  refreshDistributionRoutes(releaseId);
}

export async function removeDistributionTrackWriter(form: FormData) {
  const releaseId = text(form, "release_id");
  const writerId = text(form, "writer_id");
  const context = await loadContext(releaseId);
  const result = await context.db.from("distribution_track_writers").delete().eq("id", writerId).eq("owner_id", context.userId);
  if (result.error) throw new Error(result.error.message);
  refreshDistributionRoutes(releaseId);
}

export async function addDistributionTrackContributor(form: FormData) {
  const releaseId = text(form, "release_id");
  const trackId = text(form, "track_id");
  const context = await loadContext(releaseId);
  assertTrack(context, trackId);
  const name = text(form, "name");
  const role = text(form, "role");
  if (!name || !role) throw new Error("Contributor name and role are required.");
  const result = await context.db.from("distribution_track_contributors").insert({ owner_id: context.userId, track_id: trackId, name, role });
  if (result.error) throw new Error(result.error.message);
  refreshDistributionRoutes(releaseId);
}

export async function removeDistributionTrackContributor(form: FormData) {
  const releaseId = text(form, "release_id");
  const contributorId = text(form, "contributor_id");
  const context = await loadContext(releaseId);
  const result = await context.db.from("distribution_track_contributors").delete().eq("id", contributorId).eq("owner_id", context.userId);
  if (result.error) throw new Error(result.error.message);
  refreshDistributionRoutes(releaseId);
}

// Recovery-only bridge for ambiguous/migrated provider catalog records. Normal artist flow uses prepareDistributionCatalog.
export async function linkDistributionProviderRelease(form: FormData) {
  const releaseId = text(form, "release_id");
  const providerReleaseId = text(form, "provider_release_id");
  if (!providerReleaseId) throw new Error("Provider release ID is required.");
  const context = await loadContext(releaseId);
  const result = await context.db.from("release_distribution_configs").upsert({ release_id: releaseId, owner_id: context.userId, provider: "revelator", provider_release_id: providerReleaseId, destinations: context.config?.destinations ?? json({ mode: "all_enabled", storeIds: [] }), territories: context.config?.territories ?? json({ mode: "worldwide", countries: [] }), rights: context.config?.rights ?? {}, ai_provenance: context.config?.ai_provenance ?? {}, provider_metadata: context.config?.provider_metadata ?? {}, state: "draft", readiness_score: 0, last_validated_at: null }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await context.db.from("distribution_provider_operations").update({ state: "resolved", provider_resource_id: providerReleaseId, completed_at: new Date().toISOString() }).eq("owner_id", context.userId).eq("release_id", releaseId).eq("provider", "revelator").eq("operation_type", "prepare_catalog").in("state", ["started", "ambiguous"]);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.provider_release_recovered", actorType: "operator", provider: "revelator", payload: { providerReleaseId } });
  refreshDistributionRoutes(releaseId);
}

export async function prepareDistributionCatalog(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  await requireDistributionAccountReady(context);
  if (!distributionProviderConfigured()) throw new Error("Distribution provider credentials are not configured.");
  if (context.config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state)) throw new Error("The provider catalog cannot be changed while this release is in active distribution.");
  const localReadiness = calculateDistributionReadiness({ release: context.release, tracks: context.tracks, rights: parseRights(context.config?.rights), aiProvenance: normalizeAiProvenance(context.config?.ai_provenance), artistProfiles: context.artistProfiles, creditsReady: creditsReadiness(context) });
  if (!localReadiness.ready) {
    await persistIssues(context.db, context.userId, releaseId, localReadiness.issues);
    throw new Error("Complete the blocking Ensemblis metadata, rights and credit requirements before preparing the distribution package.");
  }
  const input = catalogInput(context);
  const ugcEnabled = parseRights(context.config?.rights)?.ugc.enabled ?? false;
  const provider = getDistributionProvider();
  if (context.config?.provider_release_id) {
    await provider.configureRelease(context.config.provider_release_id, { releaseDate: input.releaseDate, ugcEnabled });
    await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.provider_schedule_refreshed", actorType: "system", provider: context.config.provider, payload: { releaseDate: input.releaseDate } });
    refreshDistributionRoutes(releaseId);
    return;
  }

  const operationKey = `prepare_catalog:${releaseId}`;
  const existingResult = await context.db.from("distribution_provider_operations").select("*").eq("owner_id", context.userId).eq("provider", "revelator").eq("operation_key", operationKey).maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
  if (existing?.state === "completed" && existing.provider_resource_id) {
    const recover = await context.db.from("release_distribution_configs").upsert({ release_id: releaseId, owner_id: context.userId, provider: "revelator", provider_release_id: existing.provider_resource_id, destinations: context.config?.destinations ?? json({ mode: "all_enabled", storeIds: [] }), territories: context.config?.territories ?? json({ mode: "worldwide", countries: [] }), rights: context.config?.rights ?? {}, ai_provenance: context.config?.ai_provenance ?? {}, provider_metadata: context.config?.provider_metadata ?? {}, state: "draft" }, { onConflict: "release_id" });
    if (recover.error) throw new Error(recover.error.message);
    await provider.configureRelease(existing.provider_resource_id, { releaseDate: input.releaseDate, ugcEnabled });
    refreshDistributionRoutes(releaseId);
    return;
  }
  if (existing && ["started", "ambiguous"].includes(existing.state)) throw new Error("A previous provider catalog operation is unresolved. Distribution is blocked to prevent creating a duplicate release; use Operations recovery to reconcile it.");
  if (existing) {
    const restart = await context.db.from("distribution_provider_operations").update({ state: "started", request_snapshot: json(input), result_snapshot: {}, provider_resource_id: null, error: null, started_at: new Date().toISOString(), completed_at: null }).eq("id", existing.id).eq("owner_id", context.userId);
    if (restart.error) throw new Error(restart.error.message);
  } else {
    const start = await context.db.from("distribution_provider_operations").insert({ owner_id: context.userId, release_id: releaseId, provider: "revelator", operation_type: "prepare_catalog", operation_key: operationKey, state: "started", request_snapshot: json(input) });
    if (start.error) throw new Error(start.error.message);
  }

  let prepared;
  try {
    prepared = await provider.prepareRelease(input);
  } catch (error) {
    const status = providerErrorStatus(error);
    const safeFailure = status != null && status >= 400 && status < 500;
    await context.db.from("distribution_provider_operations").update({ state: safeFailure ? "failed_safe" : "ambiguous", error: error instanceof Error ? error.message : "Unknown provider preparation error", completed_at: safeFailure ? new Date().toISOString() : null }).eq("owner_id", context.userId).eq("provider", "revelator").eq("operation_key", operationKey);
    await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: safeFailure ? "distribution.provider_prepare_failed" : "distribution.provider_prepare_ambiguous", actorType: "provider", provider: "revelator", payload: { message: error instanceof Error ? error.message : "Unknown provider error" } });
    throw error;
  }

  const now = new Date().toISOString();
  const configResult = await context.db.from("release_distribution_configs").upsert({ release_id: releaseId, owner_id: context.userId, provider: "revelator", provider_release_id: prepared.providerReleaseId, destinations: context.config?.destinations ?? json({ mode: "all_enabled", storeIds: [] }), territories: context.config?.territories ?? json({ mode: "worldwide", countries: [] }), rights: context.config?.rights ?? {}, ai_provenance: context.config?.ai_provenance ?? {}, provider_metadata: json({ ...object(context.config?.provider_metadata), preparedAt: now }), state: "draft", readiness_score: 0, last_validated_at: null }, { onConflict: "release_id" });
  if (configResult.error) throw new Error(`Provider catalog was created as ${prepared.providerReleaseId}, but Ensemblis could not persist the reference. Use Operations recovery immediately. ${configResult.error.message}`);
  const operationResult = await context.db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json(prepared.raw), provider_resource_id: prepared.providerReleaseId, completed_at: now }).eq("owner_id", context.userId).eq("provider", "revelator").eq("operation_key", operationKey);
  if (operationResult.error) throw new Error(operationResult.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.provider_catalog_prepared", actorType: "system", provider: "revelator", payload: { providerReleaseId: prepared.providerReleaseId } });
  try {
    await provider.configureRelease(prepared.providerReleaseId, { releaseDate: input.releaseDate, ugcEnabled });
  } catch (error) {
    const metadata = json({ ...object(context.config?.provider_metadata), preparedAt: now, scheduleError: error instanceof Error ? error.message : "Unknown schedule configuration error" });
    await context.db.from("release_distribution_configs").update({ state: "needs_attention", provider_metadata: metadata }).eq("release_id", releaseId).eq("owner_id", context.userId);
    refreshDistributionRoutes(releaseId);
    throw new Error(`Provider catalog was created successfully, but release scheduling needs attention: ${error instanceof Error ? error.message : "unknown provider error"}`);
  }
  refreshDistributionRoutes(releaseId);
}

export async function runDistributionPreflight(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const validated = await validateContext(context);
  await persistIssues(context.db, context.userId, releaseId, validated.readiness.issues);
  const result = await context.db.from("release_distribution_configs").upsert({ release_id: releaseId, owner_id: context.userId, provider: context.config?.provider ?? "revelator", provider_release_id: context.config?.provider_release_id ?? null, destinations: context.config?.destinations ?? json({ mode: "all_enabled", storeIds: [] }), territories: context.config?.territories ?? json({ mode: "worldwide", countries: [] }), rights: context.config?.rights ?? {}, ai_provenance: context.config?.ai_provenance ?? {}, provider_metadata: context.config?.provider_metadata ?? {}, state: validated.readiness.ready ? "ready" : "needs_attention", readiness_score: validated.readiness.score, last_validated_at: new Date().toISOString() }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.preflight_completed", actorType: "system", provider: context.config?.provider ?? "revelator", payload: { score: validated.readiness.score, blockers: validated.readiness.blockingCount, warnings: validated.readiness.warningCount, storeCount: validated.selectedStoreIds.length } });
  refreshDistributionRoutes(releaseId);
}

export async function submitDistribution(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!bool(form, "confirm_submission")) throw new Error("Review and explicitly confirm the release before distribution.");
  const context = await loadContext(releaseId);
  await requireDistributionAccountReady(context);
  if (context.config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state)) throw new Error(`This release is already in distribution state '${context.config.state}'. Use update or takedown workflows instead of submitting it again.`);
  const ambiguousResult = await context.db.from("distribution_provider_operations").select("id").eq("owner_id", context.userId).eq("release_id", releaseId).eq("operation_type", "submit").in("state", ["started", "ambiguous"]).limit(1);
  if (ambiguousResult.error) throw new Error(ambiguousResult.error.message);
  if (ambiguousResult.data?.length) throw new Error("A previous provider submission is unresolved. Refresh distribution status or resolve it in Operations before attempting another delivery.");
  const validated = await validateContext(context);
  await persistIssues(context.db, context.userId, releaseId, validated.readiness.issues);
  if (!validated.readiness.ready || !context.config?.provider_release_id || !distributionProviderConfigured()) {
    const update = await context.db.from("release_distribution_configs").update({ state: "needs_attention", readiness_score: validated.readiness.score, last_validated_at: new Date().toISOString() }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    refreshDistributionRoutes(releaseId);
    throw new Error("Release is not ready to distribute. Resolve the blocking readiness issues first.");
  }

  const metadataSnapshot = json({ release: context.release, tracks: context.tracks, trackMetadata: context.trackMetadata, writers: context.writers, contributors: context.contributors, artistProfiles: context.artistProfiles });
  const assetSnapshot = json({ artwork_url: context.release.artwork_url, cover_asset: context.release.cover_asset, trackMasters: context.tracks.map((track) => ({ trackId: track.id, audioUrl: track.audio_url })) });
  const rpc = await context.db.rpc("create_distribution_submission", { p_release_id: releaseId, p_provider: context.config.provider, p_provider_release_id: context.config.provider_release_id, p_metadata_snapshot: metadataSnapshot, p_rights_snapshot: context.config.rights, p_ai_provenance_snapshot: context.config.ai_provenance, p_asset_snapshot: assetSnapshot, p_destination_snapshot: json({ mode: parseDestinationConfig(context.config.destinations).mode, storeIds: validated.selectedStoreIds }), p_provider_snapshot: json(validated.providerSnapshot ?? {}) });
  if (rpc.error || !rpc.data) throw new Error(rpc.error?.message ?? "Unable to create immutable distribution submission snapshot.");
  const submissionId = String(rpc.data);
  const operationKey = `submit:${releaseId}:${submissionId}`;
  const operation = await context.db.from("distribution_provider_operations").insert({ owner_id: context.userId, release_id: releaseId, provider: context.config.provider, operation_type: "submit", operation_key: operationKey, state: "started", request_snapshot: json({ submissionId, storeIds: validated.selectedStoreIds, providerReleaseId: context.config.provider_release_id }) });
  if (operation.error) throw new Error(operation.error.message);

  try {
    const provider = getDistributionProvider();
    await provider.submitRelease(context.config.provider_release_id, validated.selectedStoreIds);
    const now = new Date().toISOString();
    const update = await context.db.from("release_distribution_configs").update({ state: "submitted", readiness_score: validated.readiness.score, submitted_at: now, last_validated_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    await context.db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json({ accepted: true }), completed_at: now }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId, eventType: "distribution.submitted", actorType: "artist", provider: context.config.provider, payload: { storeIds: validated.selectedStoreIds } });
  } catch (error) {
    await context.db.from("distribution_provider_operations").update({ state: "ambiguous", error: error instanceof Error ? error.message : "Unknown provider submission error" }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    const update = await context.db.from("release_distribution_configs").update({ state: "error" }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(`${error instanceof Error ? error.message : "Distribution submission failed."} Database reconciliation also failed: ${update.error.message}`);
    await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId, eventType: "distribution.submit_ambiguous", actorType: "provider", provider: context.config.provider, payload: { message: error instanceof Error ? error.message : "Unknown provider error" } });
    refreshDistributionRoutes(releaseId);
    throw new Error("The provider submission result is ambiguous. Ensemblis will not retry automatically; refresh status or resolve the operation before another submission.");
  }
  refreshDistributionRoutes(releaseId);
}

function aggregateDeliveryState(states: DistributionState[]): DistributionState {
  if (!states.length) return "submitted";
  if (states.some((state) => state === "error")) return "error";
  if (states.some((state) => state === "rejected")) return "rejected";
  if (states.every((state) => state === "taken_down")) return "taken_down";
  if (states.some((state) => state === "takedown_pending")) return "takedown_pending";
  if (states.every((state) => state === "live")) return "live";
  if (states.some((state) => state === "live")) return "partially_live";
  if (states.every((state) => ["delivered", "live"].includes(state))) return "delivered";
  if (states.some((state) => ["delivering", "delivered"].includes(state))) return "delivering";
  if (states.some((state) => state === "under_review")) return "under_review";
  if (states.some((state) => state === "approved")) return "approved";
  return "submitted";
}

export async function syncDistributionStatus(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  if (!context.config?.provider_release_id) throw new Error("Provider release is not prepared yet.");
  if (!distributionProviderConfigured()) throw new Error("Distribution provider credentials are not configured.");
  const provider = getDistributionProvider();
  const deliveries = await provider.getDistributionStatus(context.config.provider_release_id);
  const now = new Date().toISOString();
  const submissionResult = await context.db.from("distribution_submissions").select("id").eq("release_id", releaseId).eq("owner_id", context.userId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (submissionResult.error) throw new Error(submissionResult.error.message);
  const latestSubmissionId = submissionResult.data?.id ?? null;
  if (deliveries.length) {
    const rows = deliveries.map((delivery) => {
      const state = providerStateToDistributionState(delivery.providerStatus);
      return { owner_id: context.userId, release_id: releaseId, submission_id: latestSubmissionId, provider: context.config!.provider, store_id: delivery.storeId, store_name: delivery.storeName, state, provider_status: delivery.providerStatus == null ? null : String(delivery.providerStatus), store_url: delivery.url ?? null, raw_status: json(delivery.raw ?? {}), delivered_at: ["delivered", "live"].includes(state) ? now : null, live_at: state === "live" ? now : null, last_synced_at: now, updated_at: now };
    });
    const upsert = await context.db.from("distribution_deliveries").upsert(rows, { onConflict: "release_id,provider,store_id" });
    if (upsert.error) throw new Error(upsert.error.message);
    await context.db.from("distribution_provider_operations").update({ state: "resolved", result_snapshot: json({ reconciledByStatus: true, deliveryCount: deliveries.length }), completed_at: now }).eq("owner_id", context.userId).eq("release_id", releaseId).eq("operation_type", "submit").in("state", ["started", "ambiguous"]);
  }
  const state = aggregateDeliveryState(deliveries.map((delivery) => providerStateToDistributionState(delivery.providerStatus)));
  const update = await context.db.from("release_distribution_configs").update({ state, last_synced_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
  if (update.error) throw new Error(update.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId: latestSubmissionId ?? undefined, eventType: "distribution.status_synced", actorType: "provider", provider: context.config.provider, payload: { state, deliveryCount: deliveries.length } });
  refreshDistributionRoutes(releaseId);
}
