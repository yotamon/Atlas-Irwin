"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
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
  type ProviderStore,
} from "@/lib/distribution/provider";
import type { Json, Release, Track } from "@/types/database";

// The repository's hand-maintained Supabase Database type intentionally lags migrations.
// Keep this boundary local to Distribution until generated database types replace it globally.
type DistributionDb = any;

type DistributionConfigRow = {
  release_id: string;
  owner_id: string;
  provider: string;
  provider_release_id: string | null;
  state: DistributionState;
  destinations: Json;
  territories: Json;
  rights: Json;
  ai_provenance: Json;
  provider_metadata: Json;
  readiness_score: number;
  submitted_at: string | null;
};

type DistributionContext = {
  db: DistributionDb;
  userId: string;
  release: Release;
  tracks: Track[];
  config: DistributionConfigRow | null;
  artistProfiles: Array<{ platform: string; external_artist_id: string | null; status: string }>;
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

function issueFingerprint(issue: DistributionIssue) {
  return createHash("sha256")
    .update([issue.code, issue.source, issue.storeId ?? "", issue.objectType ?? "", issue.objectId ?? "", issue.detail].join("|"))
    .digest("hex");
}

function parseRights(value: Json | null | undefined): DistributionRights | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const ugcRaw = raw.ugc && typeof raw.ugc === "object" && !Array.isArray(raw.ugc)
    ? raw.ugc as Record<string, unknown>
    : {};
  return {
    masterRightsConfirmed: raw.masterRightsConfirmed === true,
    compositionRightsConfirmed: raw.compositionRightsConfirmed === true,
    samplesCleared: raw.samplesCleared === true,
    contributorPermissionsConfirmed: raw.contributorPermissionsConfirmed === true,
    aiDeclarationConfirmed: raw.aiDeclarationConfirmed === true,
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { mode: "all_enabled" as const, storeIds: [] as number[] };
  }
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === "custom" ? "custom" as const : "all_enabled" as const;
  const storeIds = Array.isArray(raw.storeIds)
    ? [...new Set(raw.storeIds.map(Number).filter(Number.isFinite))]
    : [];
  return { mode, storeIds };
}

async function loadContext(releaseId: string): Promise<DistributionContext> {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as DistributionDb;
  const [releaseResult, tracksResult, configResult, profilesResult] = await Promise.all([
    supabase.from("releases").select("*").eq("id", releaseId).eq("owner_id", user.id).single(),
    supabase.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_artist_profiles").select("platform,external_artist_id,status").eq("owner_id", user.id),
  ]);
  if (releaseResult.error || !releaseResult.data) throw new Error("Release not found or unauthorized.");
  if (tracksResult.error) throw new Error(tracksResult.error.message);
  if (configResult.error) throw new Error(configResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);
  return {
    db,
    userId: user.id,
    release: releaseResult.data,
    tracks: tracksResult.data ?? [],
    config: configResult.data,
    artistProfiles: profilesResult.data ?? [],
  };
}

async function resolveStoreSelection(config: DistributionConfigRow | null, provider: DistributionProvider) {
  const available = (await provider.listStores()).filter((store) => store.active);
  const destination = parseDestinationConfig(config?.destinations);
  const allowedIds = new Set(available.map((store) => store.id));
  const selected = destination.mode === "custom"
    ? destination.storeIds.filter((id) => allowedIds.has(id))
    : available.map((store) => store.id);
  return { available, selected };
}

function providerSetupIssues(config: DistributionConfigRow | null): DistributionIssue[] {
  const issues: DistributionIssue[] = [];
  if (!config?.provider_release_id) {
    issues.push({
      code: "provider.release_not_prepared",
      title: "Provider catalog preparation is pending",
      detail: "Ensemblis has not linked this release to its provider catalog record yet. Distribution cannot be submitted until the provider release exists.",
      severity: "error",
      source: "provider",
      objectType: "release",
      objectId: config?.release_id,
    });
  }
  if (!distributionProviderConfigured()) {
    issues.push({
      code: "provider.credentials_unavailable",
      title: "Distribution provider is not connected",
      detail: "Distribution provider credentials must be configured on the server before Ensemblis can validate or deliver releases.",
      severity: "error",
      source: "provider",
      objectType: "account",
    });
  }
  return issues;
}

async function requireDistributionAccountReady(context: DistributionContext) {
  const provider = context.config?.provider ?? "revelator";
  const result = await context.db
    .from("distribution_accounts")
    .select("status,agreement_accepted_at,rights_terms_accepted_at")
    .eq("owner_id", context.userId)
    .eq("provider", provider)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const account = result.data;
  if (!account?.agreement_accepted_at || !account?.rights_terms_accepted_at) {
    throw new Error("Complete distribution onboarding and accept the distribution terms before submitting a release.");
  }
  if (["setup_required", "restricted", "suspended"].includes(String(account.status))) {
    throw new Error("This distribution account is not currently eligible to submit releases. Resolve the account status first.");
  }
}

async function persistIssues(db: DistributionDb, userId: string, releaseId: string, issues: DistributionIssue[]) {
  const now = new Date().toISOString();
  const staleResult = await db.from("distribution_validation_issues")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("owner_id", userId)
    .eq("release_id", releaseId)
    .in("status", ["open", "acknowledged"]);
  if (staleResult.error) throw new Error(staleResult.error.message);

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
    status: "open",
    raw_issue: issue as unknown as Json,
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
      if (!selectedStoreIds.length) {
        providerIssues.push({
          code: "provider.no_stores_selected",
          title: "Choose at least one music service",
          detail: "No active provider stores are currently selected for this release.",
          severity: "error",
          source: "provider",
          objectType: "release",
          objectId: context.release.id,
        });
      } else {
        const validation = await provider.validateRelease(context.config.provider_release_id, selectedStoreIds);
        providerIssues = providerIssues.concat(validation.issues);
        providerSnapshot = validation.raw;
      }
    } catch (error) {
      providerIssues.push({
        code: "provider.validation_unavailable",
        title: "Provider validation could not complete",
        detail: error instanceof Error ? error.message : "The provider validation request failed.",
        severity: "error",
        source: "provider",
        objectType: "release",
        objectId: context.release.id,
      });
    }
  }

  const readiness = calculateDistributionReadiness({
    release: context.release,
    tracks: context.tracks,
    rights: parseRights(context.config?.rights),
    aiProvenance: normalizeAiProvenance(context.config?.ai_provenance),
    artistProfiles: context.artistProfiles,
    providerIssues,
  });
  return { readiness, stores, selectedStoreIds, providerSnapshot };
}

async function logEvent(db: DistributionDb, input: { ownerId: string; releaseId?: string; submissionId?: string; eventType: string; actorType?: "artist" | "operator" | "system" | "provider"; provider?: string; payload?: Json }) {
  const result = await db.from("distribution_events").insert({
    owner_id: input.ownerId,
    release_id: input.releaseId ?? null,
    submission_id: input.submissionId ?? null,
    event_type: input.eventType,
    actor_type: input.actorType ?? "system",
    provider: input.provider ?? null,
    payload: input.payload ?? {},
  });
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

export async function saveDistributionAccount(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as DistributionDb;
  const legalName = text(form, "legal_name");
  const countryCode = text(form, "country_code").toUpperCase();
  if (!legalName || !/^[A-Z]{2}$/.test(countryCode)) throw new Error("Legal name and a two-letter country code are required.");
  const agreementAccepted = bool(form, "agreement_accepted");
  const rightsTermsAccepted = bool(form, "rights_terms_accepted");
  if (!agreementAccepted || !rightsTermsAccepted) throw new Error("Distribution and rights terms must be explicitly accepted.");
  const now = new Date().toISOString();
  const result = await db.from("distribution_accounts").upsert({
    owner_id: user.id,
    provider: "revelator",
    legal_name: legalName,
    country_code: countryCode,
    agreement_accepted_at: now,
    rights_terms_accepted_at: now,
    status: "pending_verification",
    kyc_status: "pending",
    payout_status: "pending",
  }, { onConflict: "owner_id,provider" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(db, { ownerId: user.id, eventType: "distribution.account_terms_confirmed", actorType: "artist", provider: "revelator", payload: { countryCode } });
  refreshDistributionRoutes();
}

export async function saveDistributionDeclarations(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const ugcEnabled = bool(form, "ugc_enabled");
  const rights: DistributionRights = {
    masterRightsConfirmed: bool(form, "master_rights_confirmed"),
    compositionRightsConfirmed: bool(form, "composition_rights_confirmed"),
    samplesCleared: bool(form, "samples_cleared"),
    contributorPermissionsConfirmed: bool(form, "contributor_permissions_confirmed"),
    aiDeclarationConfirmed: bool(form, "ai_declaration_confirmed"),
    territories: "worldwide",
    ugc: {
      enabled: ugcEnabled,
      exclusiveMasterConfirmed: ugcEnabled ? bool(form, "ugc_exclusive_master_confirmed") : false,
      noUnlicensedSamplesConfirmed: ugcEnabled ? bool(form, "ugc_no_unlicensed_samples_confirmed") : false,
      noNonExclusiveBeatsConfirmed: ugcEnabled ? bool(form, "ugc_no_nonexclusive_beats_confirmed") : false,
      noUnauthorizedVoicesConfirmed: ugcEnabled ? bool(form, "ugc_no_unauthorized_voices_confirmed") : false,
    },
  };
  const aiProvenance: AIProvenance = {
    artistIdentity: ["human", "virtual", "ai_persona"].includes(text(form, "artist_identity")) ? text(form, "artist_identity") as AIProvenance["artistIdentity"] : "human",
    composition: { involvement: ["none", "assisted", "generated"].includes(text(form, "composition_ai")) ? text(form, "composition_ai") as AIProvenance["composition"]["involvement"] : "none", provider: optionalText(form, "composition_provider") },
    lyrics: { involvement: ["none", "assisted", "generated"].includes(text(form, "lyrics_ai")) ? text(form, "lyrics_ai") as AIProvenance["lyrics"]["involvement"] : "none", provider: optionalText(form, "lyrics_provider") },
    vocals: {
      involvement: ["human", "synthetic", "mixed"].includes(text(form, "vocals_ai")) ? text(form, "vocals_ai") as AIProvenance["vocals"]["involvement"] : "human",
      clonedVoice: bool(form, "cloned_voice"),
      authorizationConfirmed: bool(form, "voice_authorization_confirmed"),
      provider: optionalText(form, "vocals_provider"),
    },
    instrumentation: { involvement: ["none", "assisted", "generated"].includes(text(form, "instrumentation_ai")) ? text(form, "instrumentation_ai") as AIProvenance["instrumentation"]["involvement"] : "none", provider: optionalText(form, "instrumentation_provider") },
    production: { involvement: ["none", "assisted", "generated"].includes(text(form, "production_ai")) ? text(form, "production_ai") as AIProvenance["production"]["involvement"] : "none", provider: optionalText(form, "production_provider") },
  };
  const destinationMode = text(form, "destination_mode") === "custom" ? "custom" : "all_enabled";
  const storeIds = form.getAll("store_id").map(Number).filter(Number.isFinite);
  const result = await context.db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: context.userId,
    provider: context.config?.provider ?? "revelator",
    provider_release_id: context.config?.provider_release_id ?? null,
    state: context.config?.state && !["draft", "needs_attention", "ready"].includes(context.config.state) ? context.config.state : "draft",
    destinations: { mode: destinationMode, storeIds },
    territories: { mode: "worldwide", countries: [] },
    rights,
    ai_provenance: aiProvenance,
    provider_metadata: context.config?.provider_metadata ?? {},
    readiness_score: 0,
    last_validated_at: null,
  }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.declarations_saved", actorType: "artist", provider: context.config?.provider ?? "revelator", payload: { destinationMode, storeCount: storeIds.length, ugcEnabled } });
  refreshDistributionRoutes(releaseId);
}

export async function saveDistributionArtistProfile(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const platform = text(form, "platform").toLowerCase();
  if (!["spotify", "apple_music", "amazon_music", "youtube_music"].includes(platform)) throw new Error("Unsupported artist profile platform.");
  const externalArtistId = text(form, "external_artist_id");
  const externalUrl = text(form, "external_url");
  const createNew = bool(form, "create_new");
  if (!createNew && !externalArtistId) throw new Error("Choose an existing artist profile or mark this as a new profile.");
  const result = await context.db.from("distribution_artist_profiles").upsert({
    owner_id: context.userId,
    artist_name: context.release.artist,
    platform,
    external_artist_id: createNew ? null : externalArtistId,
    external_url: createNew ? null : externalUrl || null,
    status: createNew ? "create_new" : "confirmed",
    confirmed_at: new Date().toISOString(),
  }, { onConflict: "owner_id,artist_name,platform" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.artist_profile_confirmed", actorType: "artist", payload: { platform, createNew } });
  refreshDistributionRoutes(releaseId);
}

// Operator-only bridge until provider catalog creation is fully automated from generic Ensemblis credits/media metadata.
export async function linkDistributionProviderRelease(form: FormData) {
  const releaseId = text(form, "release_id");
  const providerReleaseId = text(form, "provider_release_id");
  if (!providerReleaseId) throw new Error("Provider release ID is required.");
  const context = await loadContext(releaseId);
  const result = await context.db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: context.userId,
    provider: "revelator",
    provider_release_id: providerReleaseId,
    destinations: context.config?.destinations ?? { mode: "all_enabled", storeIds: [] },
    territories: context.config?.territories ?? { mode: "worldwide", countries: [] },
    rights: context.config?.rights ?? {},
    ai_provenance: context.config?.ai_provenance ?? {},
    provider_metadata: context.config?.provider_metadata ?? {},
    state: "draft",
    readiness_score: 0,
    last_validated_at: null,
  }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.provider_release_linked", actorType: "operator", provider: "revelator", payload: { providerReleaseId } });
  refreshDistributionRoutes(releaseId);
}

export async function runDistributionPreflight(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const validated = await validateContext(context);
  await persistIssues(context.db, context.userId, releaseId, validated.readiness.issues);
  const result = await context.db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: context.userId,
    provider: context.config?.provider ?? "revelator",
    provider_release_id: context.config?.provider_release_id ?? null,
    destinations: context.config?.destinations ?? { mode: "all_enabled", storeIds: [] },
    territories: context.config?.territories ?? { mode: "worldwide", countries: [] },
    rights: context.config?.rights ?? {},
    ai_provenance: context.config?.ai_provenance ?? {},
    provider_metadata: context.config?.provider_metadata ?? {},
    state: validated.readiness.ready ? "ready" : "needs_attention",
    readiness_score: validated.readiness.score,
    last_validated_at: new Date().toISOString(),
  }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, eventType: "distribution.preflight_completed", actorType: "system", provider: context.config?.provider ?? "revelator", payload: { score: validated.readiness.score, blockers: validated.readiness.blockingCount, warnings: validated.readiness.warningCount, storeCount: validated.selectedStoreIds.length } });
  refreshDistributionRoutes(releaseId);
}

export async function submitDistribution(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!bool(form, "confirm_submission")) throw new Error("Review and explicitly confirm the release before distribution.");
  const context = await loadContext(releaseId);
  await requireDistributionAccountReady(context);
  if (context.config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state)) {
    throw new Error(`This release is already in distribution state '${context.config.state}'. Use update or takedown workflows instead of submitting it again.`);
  }
  const validated = await validateContext(context);
  await persistIssues(context.db, context.userId, releaseId, validated.readiness.issues);
  if (!validated.readiness.ready || !context.config?.provider_release_id || !distributionProviderConfigured()) {
    const update = await context.db.from("release_distribution_configs").update({ state: "needs_attention", readiness_score: validated.readiness.score, last_validated_at: new Date().toISOString() }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    refreshDistributionRoutes(releaseId);
    throw new Error("Release is not ready to distribute. Resolve the blocking readiness issues first.");
  }

  const metadataSnapshot = {
    release: context.release,
    tracks: context.tracks.map((track) => ({ id: track.id, title: track.title, version: track.version, duration: track.duration, audio_url: track.audio_url, track_number: track.track_number, display_order: track.display_order })),
    artistProfiles: context.artistProfiles,
  };
  const assetSnapshot = {
    artwork_url: context.release.artwork_url,
    cover_asset: context.release.cover_asset,
    trackMasters: context.tracks.map((track) => ({ trackId: track.id, audioUrl: track.audio_url })),
  };
  const rpc = await context.db.rpc("create_distribution_submission", {
    p_release_id: releaseId,
    p_provider: context.config.provider,
    p_provider_release_id: context.config.provider_release_id,
    p_metadata_snapshot: metadataSnapshot,
    p_rights_snapshot: context.config.rights,
    p_ai_provenance_snapshot: context.config.ai_provenance,
    p_asset_snapshot: assetSnapshot,
    p_destination_snapshot: { mode: parseDestinationConfig(context.config.destinations).mode, storeIds: validated.selectedStoreIds },
    p_provider_snapshot: validated.providerSnapshot ?? {},
  });
  if (rpc.error || !rpc.data) throw new Error(rpc.error?.message ?? "Unable to create immutable distribution submission snapshot.");
  const submissionId = String(rpc.data);

  try {
    const provider = getDistributionProvider();
    await provider.submitRelease(context.config.provider_release_id, validated.selectedStoreIds);
    const now = new Date().toISOString();
    const update = await context.db.from("release_distribution_configs").update({ state: "submitted", readiness_score: validated.readiness.score, submitted_at: now, last_validated_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId, eventType: "distribution.submitted", actorType: "artist", provider: context.config.provider, payload: { storeIds: validated.selectedStoreIds } });
  } catch (error) {
    const update = await context.db.from("release_distribution_configs").update({ state: "error" }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(`${error instanceof Error ? error.message : "Distribution submission failed."} Database reconciliation also failed: ${update.error.message}`);
    await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId, eventType: "distribution.submit_failed", actorType: "provider", provider: context.config.provider, payload: { message: error instanceof Error ? error.message : "Unknown provider error" } });
    refreshDistributionRoutes(releaseId);
    throw error;
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
  if (!context.config?.provider_release_id) throw new Error("Provider release is not linked yet.");
  if (!distributionProviderConfigured()) throw new Error("Distribution provider credentials are not configured.");
  const provider = getDistributionProvider();
  const deliveries = await provider.getDistributionStatus(context.config.provider_release_id);
  const now = new Date().toISOString();
  let latestSubmissionId: string | null = null;
  const submissionResult = await context.db.from("distribution_submissions").select("id").eq("release_id", releaseId).eq("owner_id", context.userId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (submissionResult.error) throw new Error(submissionResult.error.message);
  latestSubmissionId = submissionResult.data?.id ?? null;

  if (deliveries.length) {
    const rows = deliveries.map((delivery) => {
      const state = providerStateToDistributionState(delivery.providerStatus);
      return {
        owner_id: context.userId,
        release_id: releaseId,
        submission_id: latestSubmissionId,
        provider: context.config!.provider,
        store_id: delivery.storeId,
        store_name: delivery.storeName,
        state,
        provider_status: delivery.providerStatus == null ? null : String(delivery.providerStatus),
        store_url: delivery.url ?? null,
        raw_status: (delivery.raw ?? {}) as Json,
        delivered_at: ["delivered", "live"].includes(state) ? now : null,
        live_at: state === "live" ? now : null,
        last_synced_at: now,
        updated_at: now,
      };
    });
    const upsert = await context.db.from("distribution_deliveries").upsert(rows, { onConflict: "release_id,provider,store_id" });
    if (upsert.error) throw new Error(upsert.error.message);
  }

  const state = aggregateDeliveryState(deliveries.map((delivery) => providerStateToDistributionState(delivery.providerStatus)));
  const update = await context.db.from("release_distribution_configs").update({ state, last_synced_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
  if (update.error) throw new Error(update.error.message);
  await logEvent(context.db, { ownerId: context.userId, releaseId, submissionId: latestSubmissionId ?? undefined, eventType: "distribution.status_synced", actorType: "provider", provider: context.config.provider, payload: { state, deliveryCount: deliveries.length } });
  refreshDistributionRoutes(releaseId);
}
