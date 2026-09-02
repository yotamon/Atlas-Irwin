"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  calculateDistributionReadiness,
  normalizeAiProvenance,
  providerStateToDistributionState,
  type DistributionIssue,
  type DistributionRights,
  type DistributionState,
} from "@/lib/distribution/domain";
import { providerForDistributionAccount } from "@/lib/distribution/provider-account";
import type { DistributionProvider, ProviderStore } from "@/lib/distribution/provider";
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

type Db = SupabaseClient<DistributionDatabase>;

type RuntimeContext = {
  db: Db;
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

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function parseRights(value: Json | null | undefined): DistributionRights | null {
  const raw = object(value);
  if (!Object.keys(raw).length) return null;
  const ugc = object(raw.ugc as Json | undefined);
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
      enabled: ugc.enabled === true,
      exclusiveMasterConfirmed: ugc.exclusiveMasterConfirmed === true,
      noUnlicensedSamplesConfirmed: ugc.noUnlicensedSamplesConfirmed === true,
      noNonExclusiveBeatsConfirmed: ugc.noNonExclusiveBeatsConfirmed === true,
      noUnauthorizedVoicesConfirmed: ugc.noUnauthorizedVoicesConfirmed === true,
    },
  };
}

function parseDestinationConfig(value: Json | null | undefined) {
  const raw = object(value);
  const mode = raw.mode === "custom" ? "custom" as const : "all_enabled" as const;
  const storeIds = Array.isArray(raw.storeIds) ? [...new Set(raw.storeIds.map(Number).filter(Number.isFinite))] : [];
  return { mode, storeIds };
}

function issueFingerprint(issue: DistributionIssue) {
  return createHash("sha256")
    .update([issue.code, issue.source, issue.storeId ?? "", issue.objectType ?? "", issue.objectId ?? "", issue.detail].join("|"))
    .digest("hex");
}

async function loadContext(releaseId: string): Promise<RuntimeContext> {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
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

function requireAccountReady(context: RuntimeContext) {
  const account = context.account;
  if (!account?.agreement_accepted_at || !account.rights_terms_accepted_at) throw new Error("Complete distribution onboarding and accept the distribution terms before continuing.");
  if (["setup_required", "restricted", "suspended"].includes(account.status)) throw new Error("This distribution account is not currently eligible to submit releases.");
  const metadata = object(account.provider_metadata);
  if (metadata.accountModel === "child" && !account.provider_account_id) throw new Error("The distribution child account has not finished provisioning.");
}

function creditsReadiness(context: RuntimeContext) {
  const issues: DistributionIssue[] = [];
  const metadataByTrack = new Map(context.trackMetadata.map((row) => [row.track_id, row]));
  for (const track of context.tracks) {
    const metadata = metadataByTrack.get(track.id);
    if (!metadata) issues.push({ code: "credits.track_metadata", title: `Complete distribution metadata for ${track.title}`, detail: "Language, explicit status and track origin are required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    const writers = context.writers.filter((row) => row.track_id === track.id);
    if (!writers.length) issues.push({ code: "credits.writer_missing", title: `Add writer credits for ${track.title}`, detail: "At least one legal composer or lyricist is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    else {
      const share = writers.reduce((sum, writer) => sum + Number(writer.share), 0);
      if (Math.abs(share - 100) > 0.01) issues.push({ code: "credits.writer_share", title: `Writer shares for ${track.title} must total 100%`, detail: `Current total is ${share.toFixed(2)}%.`, severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
      if (writers.some((writer) => writer.publishing_type === "published" && !writer.publisher_name?.trim())) issues.push({ code: "credits.publisher_missing", title: `Add publisher details for ${track.title}`, detail: "Published writers need a publisher name.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    if (!context.contributors.some((row) => row.track_id === track.id)) issues.push({ code: "credits.production_missing", title: `Add a production credit for ${track.title}`, detail: "At least one production or engineering contributor is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
  }
  return { ready: issues.length === 0, detail: issues.length ? `${issues.length} catalog credit issue${issues.length === 1 ? "" : "s"} remain` : "Track metadata, writers and production credits are complete", issues };
}

async function resolveStoreSelection(config: ReleaseDistributionConfig | null, provider: DistributionProvider) {
  const available = (await provider.listStores()).filter((store) => store.active);
  const destination = parseDestinationConfig(config?.destinations);
  const allowed = new Set(available.map((store) => store.id));
  const selected = destination.mode === "custom" ? destination.storeIds.filter((id) => allowed.has(id)) : available.map((store) => store.id);
  return { available, selected };
}

async function validateContext(context: RuntimeContext) {
  const providerIssues: DistributionIssue[] = [];
  let stores: ProviderStore[] = [];
  let selectedStoreIds: number[] = [];
  let providerSnapshot: unknown = null;
  if (!context.config?.provider_release_id) {
    providerIssues.push({ code: "provider.release_not_prepared", title: "Distribution package has not been prepared", detail: "Synchronize the provider package before final preflight.", severity: "error", source: "provider", objectType: "release", objectId: context.release.id });
  } else {
    try {
      requireAccountReady(context);
      const provider = providerForDistributionAccount(context.account);
      const selection = await resolveStoreSelection(context.config, provider);
      stores = selection.available;
      selectedStoreIds = selection.selected;
      if (!selectedStoreIds.length) {
        providerIssues.push({ code: "provider.no_stores_selected", title: "Choose at least one music service", detail: "No active provider stores are selected for this release.", severity: "error", source: "provider", objectType: "release", objectId: context.release.id });
      } else {
        const validation = await provider.validateRelease(context.config.provider_release_id, selectedStoreIds);
        providerIssues.push(...validation.issues);
        providerSnapshot = validation.raw;
      }
    } catch (error) {
      providerIssues.push({ code: "provider.validation_unavailable", title: "Provider validation could not complete", detail: error instanceof Error ? error.message : "Provider validation failed.", severity: "error", source: "provider", objectType: "release", objectId: context.release.id });
    }
  }
  const readiness = calculateDistributionReadiness({
    release: context.release,
    tracks: context.tracks,
    rights: parseRights(context.config?.rights),
    aiProvenance: normalizeAiProvenance(context.config?.ai_provenance),
    artistProfiles: context.artistProfiles,
    providerIssues,
    creditsReady: creditsReadiness(context),
  });
  return { readiness, stores, selectedStoreIds, providerSnapshot };
}

async function persistIssues(context: RuntimeContext, issues: DistributionIssue[]) {
  const now = new Date().toISOString();
  const stale = await context.db.from("distribution_validation_issues").update({ status: "resolved", resolved_at: now, updated_at: now }).eq("owner_id", context.userId).eq("release_id", context.release.id).in("status", ["open", "acknowledged"]);
  if (stale.error) throw new Error(stale.error.message);
  if (!issues.length) return;
  const rows = issues.map((issue) => ({
    owner_id: context.userId,
    release_id: context.release.id,
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
  const result = await context.db.from("distribution_validation_issues").upsert(rows, { onConflict: "release_id,fingerprint" });
  if (result.error) throw new Error(result.error.message);
}

async function logEvent(context: RuntimeContext, input: { submissionId?: string; eventType: string; actorType: "artist" | "provider" | "system"; payload?: Json }) {
  const result = await context.db.from("distribution_events").insert({
    owner_id: context.userId,
    release_id: context.release.id,
    submission_id: input.submissionId ?? null,
    event_type: input.eventType,
    actor_type: input.actorType,
    provider: context.config?.provider ?? "revelator",
    payload: input.payload ?? {},
  });
  if (result.error) throw new Error(result.error.message);
}

function refresh(releaseId: string) {
  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}

export async function runDistributionPreflight(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  const validated = await validateContext(context);
  await persistIssues(context, validated.readiness.issues);
  const result = await context.db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: context.userId,
    provider: context.config?.provider ?? "revelator",
    provider_release_id: context.config?.provider_release_id ?? null,
    destinations: context.config?.destinations ?? json({ mode: "all_enabled", storeIds: [] }),
    territories: context.config?.territories ?? json({ mode: "worldwide", countries: [] }),
    rights: context.config?.rights ?? {},
    ai_provenance: context.config?.ai_provenance ?? {},
    provider_metadata: context.config?.provider_metadata ?? {},
    state: validated.readiness.ready ? "ready" : "needs_attention",
    readiness_score: validated.readiness.score,
    last_validated_at: new Date().toISOString(),
  }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);
  await logEvent(context, { eventType: "distribution.preflight_completed", actorType: "system", payload: json({ score: validated.readiness.score, blockers: validated.readiness.blockingCount, warnings: validated.readiness.warningCount, storeCount: validated.selectedStoreIds.length }) });
  refresh(releaseId);
}

export async function submitDistribution(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!bool(form, "confirm_submission")) throw new Error("Review and explicitly confirm the release before distribution.");
  const context = await loadContext(releaseId);
  requireAccountReady(context);
  if (context.config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(context.config.state)) throw new Error(`This release is already in distribution state '${context.config.state}'.`);
  const unresolved = await context.db.from("distribution_provider_operations").select("id").eq("owner_id", context.userId).eq("release_id", releaseId).eq("operation_type", "submit").in("state", ["started", "ambiguous"]).limit(1);
  if (unresolved.error) throw new Error(unresolved.error.message);
  if (unresolved.data?.length) throw new Error("A previous provider submission is unresolved. Refresh status or resolve it in Operations before another delivery.");

  const validated = await validateContext(context);
  await persistIssues(context, validated.readiness.issues);
  if (!validated.readiness.ready || !context.config?.provider_release_id) {
    const update = await context.db.from("release_distribution_configs").update({ state: "needs_attention", readiness_score: validated.readiness.score, last_validated_at: new Date().toISOString() }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    refresh(releaseId);
    throw new Error("Release is not ready to distribute. Resolve the blocking readiness issues first.");
  }

  const metadataSnapshot = json({ release: context.release, tracks: context.tracks, trackMetadata: context.trackMetadata, writers: context.writers, contributors: context.contributors, artistProfiles: context.artistProfiles, providerAccountId: context.account?.provider_account_id ?? null });
  const assetSnapshot = json({ artwork_url: context.release.artwork_url, cover_asset: context.release.cover_asset, trackMasters: context.tracks.map((track) => ({ trackId: track.id, audioUrl: track.audio_url })) });
  const rpc = await context.db.rpc("create_distribution_submission", {
    p_release_id: releaseId,
    p_provider: context.config.provider,
    p_provider_release_id: context.config.provider_release_id,
    p_metadata_snapshot: metadataSnapshot,
    p_rights_snapshot: context.config.rights,
    p_ai_provenance_snapshot: context.config.ai_provenance,
    p_asset_snapshot: assetSnapshot,
    p_destination_snapshot: json({ mode: parseDestinationConfig(context.config.destinations).mode, storeIds: validated.selectedStoreIds }),
    p_provider_snapshot: json(validated.providerSnapshot ?? {}),
  });
  if (rpc.error || !rpc.data) throw new Error(rpc.error?.message ?? "Unable to create immutable distribution submission snapshot.");
  const submissionId = String(rpc.data);
  const operationKey = `submit:${releaseId}:${submissionId}`;
  const operation = await context.db.from("distribution_provider_operations").insert({
    owner_id: context.userId,
    release_id: releaseId,
    provider: context.config.provider,
    operation_type: "submit",
    operation_key: operationKey,
    state: "started",
    request_snapshot: json({ submissionId, storeIds: validated.selectedStoreIds, providerReleaseId: context.config.provider_release_id, providerAccountId: context.account?.provider_account_id ?? null }),
  });
  if (operation.error) throw new Error(operation.error.message);

  try {
    const provider = providerForDistributionAccount(context.account);
    await provider.submitRelease(context.config.provider_release_id, validated.selectedStoreIds);
    const now = new Date().toISOString();
    const update = await context.db.from("release_distribution_configs").update({ state: "submitted", readiness_score: validated.readiness.score, submitted_at: now, last_validated_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (update.error) throw new Error(update.error.message);
    const operationUpdate = await context.db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json({ accepted: true }), completed_at: now }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    if (operationUpdate.error) throw new Error(operationUpdate.error.message);
    await logEvent(context, { submissionId, eventType: "distribution.submitted", actorType: "artist", payload: json({ storeIds: validated.selectedStoreIds }) });
  } catch (error) {
    await context.db.from("distribution_provider_operations").update({ state: "ambiguous", error: error instanceof Error ? error.message : "Unknown provider submission error" }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    await context.db.from("release_distribution_configs").update({ state: "error" }).eq("release_id", releaseId).eq("owner_id", context.userId);
    await logEvent(context, { submissionId, eventType: "distribution.submit_ambiguous", actorType: "provider", payload: json({ message: error instanceof Error ? error.message : "Unknown provider error" }) });
    refresh(releaseId);
    throw new Error("The provider submission result is ambiguous. Ensemblis will not retry automatically; refresh status or resolve the operation before another submission.");
  }
  refresh(releaseId);
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
  requireAccountReady(context);
  if (!context.config?.provider_release_id) throw new Error("Provider release is not prepared yet.");
  const provider = providerForDistributionAccount(context.account);
  const deliveries = await provider.getDistributionStatus(context.config.provider_release_id);
  const now = new Date().toISOString();
  const submissionResult = await context.db.from("distribution_submissions").select("id").eq("release_id", releaseId).eq("owner_id", context.userId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (submissionResult.error) throw new Error(submissionResult.error.message);
  const latestSubmissionId = submissionResult.data?.id ?? null;
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
        raw_status: json(delivery.raw ?? {}),
        delivered_at: ["delivered", "live"].includes(state) ? now : null,
        live_at: state === "live" ? now : null,
        last_synced_at: now,
        updated_at: now,
      };
    });
    const upsert = await context.db.from("distribution_deliveries").upsert(rows, { onConflict: "release_id,provider,store_id" });
    if (upsert.error) throw new Error(upsert.error.message);
    await context.db.from("distribution_provider_operations").update({ state: "resolved", result_snapshot: json({ reconciledByStatus: true, deliveryCount: deliveries.length }), completed_at: now }).eq("owner_id", context.userId).eq("release_id", releaseId).eq("operation_type", "submit").in("state", ["started", "ambiguous"]);
  }
  const state = aggregateDeliveryState(deliveries.map((delivery) => providerStateToDistributionState(delivery.providerStatus)));
  const update = await context.db.from("release_distribution_configs").update({ state, last_synced_at: now }).eq("release_id", releaseId).eq("owner_id", context.userId);
  if (update.error) throw new Error(update.error.message);
  await logEvent(context, { submissionId: latestSubmissionId ?? undefined, eventType: "distribution.status_synced", actorType: "provider", payload: json({ state, deliveryCount: deliveries.length }) });
  refresh(releaseId);
}
