"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { getProviderCatalogIdentity } from "@/lib/distribution/provider-catalog-identity";
import { providerForDistributionAccount } from "@/lib/distribution/provider-account";
import {
  assertSafeDistributedReleaseUpdate,
  updateModeFromProviderMetadata,
  type DistributionProviderAssignedIdentity,
  type DistributionUpdateBaseline,
} from "@/lib/distribution/update-safety";
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

type UpdateContext = {
  db: Db;
  userId: string;
  release: Release;
  tracks: Track[];
  config: ReleaseDistributionConfig;
  account: DistributionAccount;
  trackMetadata: DistributionTrackMetadata[];
  writers: DistributionTrackWriter[];
  contributors: DistributionTrackContributor[];
  artistProfiles: DistributionArtistProfile[];
};

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function bool(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function refresh(releaseId: string) {
  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}

async function loadContext(releaseId: string): Promise<UpdateContext> {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const [releaseResult, tracksResult, configResult, accountResult, metadataResult, writersResult, contributorsResult, profilesResult] = await Promise.all([
    db.from("releases").select("*").eq("id", releaseId).eq("owner_id", user.id).single(),
    db.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).single(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").single(),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id),
  ]);
  for (const result of [releaseResult, tracksResult, configResult, accountResult, metadataResult, writersResult, contributorsResult, profilesResult]) {
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
    trackMetadata: (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    writers: (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    contributors: (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id)),
    artistProfiles: (profilesResult.data ?? []).filter((profile) => profile.artist_name === releaseResult.data.artist),
  };
}

async function loadBaseline(context: UpdateContext, submissionId?: string): Promise<DistributionUpdateBaseline> {
  let query = context.db.from("distribution_submissions")
    .select("id,version,metadata_snapshot,asset_snapshot,destination_snapshot")
    .eq("release_id", context.release.id)
    .eq("owner_id", context.userId);
  if (submissionId) query = query.eq("id", submissionId);
  const result = submissionId
    ? await query.single()
    : await query.order("version", { ascending: false }).limit(1).single();
  if (result.error) throw new Error(result.error.message);
  return {
    submissionId: result.data.id,
    version: result.data.version,
    metadataSnapshot: result.data.metadata_snapshot,
    assetSnapshot: result.data.asset_snapshot,
    destinationSnapshot: result.data.destination_snapshot,
  };
}

async function reconcileAssignedIdentity(context: UpdateContext) {
  if (!context.config.provider_release_id) throw new Error("Provider release identity is missing.");
  const provider = await getProviderCatalogIdentity(context.account, context.config.provider_release_id);
  if (provider.tracks.length !== context.tracks.length) {
    throw new Error("Provider and Ensemblis track counts differ. This release cannot be corrected in place; reconcile or use takedown + new release.");
  }

  let release = context.release;
  const localUpc = normalized(release.upc);
  const providerUpc = normalized(provider.upc);
  if (!providerUpc) throw new Error("The provider has not assigned a UPC yet. Refresh distribution status after provider processing completes.");
  if (localUpc && localUpc !== providerUpc) throw new Error(`Provider UPC ${provider.upc} conflicts with Ensemblis UPC ${release.upc}.`);
  if (!localUpc && provider.upc) {
    const write = await context.db.from("releases").update({ upc: provider.upc }).eq("id", release.id).eq("owner_id", context.userId);
    if (write.error) throw new Error(write.error.message);
    release = { ...release, upc: provider.upc };
  }

  const metadataByTrack = new Map(context.trackMetadata.map((row) => [row.track_id, row]));
  const reconciledMetadata: DistributionTrackMetadata[] = [];
  const assignedTracks: NonNullable<DistributionProviderAssignedIdentity["tracks"]> = [];
  for (let index = 0; index < context.tracks.length; index += 1) {
    const track = context.tracks[index];
    const providerTrack = provider.tracks[index];
    const row = metadataByTrack.get(track.id);
    if (!row) throw new Error(`Track '${track.title}' is missing distribution metadata.`);
    const localIsrc = normalized(row.isrc);
    const providerIsrc = normalized(providerTrack.isrc);
    if (!providerIsrc) throw new Error(`The provider has not assigned an ISRC to '${track.title}' yet. Refresh status after provider processing completes.`);
    if (localIsrc && localIsrc !== providerIsrc) throw new Error(`Provider ISRC ${providerTrack.isrc} conflicts with Ensemblis ISRC ${row.isrc} for '${track.title}'.`);
    let reconciled = row;
    if (!localIsrc && providerTrack.isrc) {
      const write = await context.db.from("distribution_track_metadata").update({ isrc: providerTrack.isrc }).eq("track_id", track.id).eq("owner_id", context.userId);
      if (write.error) throw new Error(write.error.message);
      reconciled = { ...row, isrc: providerTrack.isrc };
    }
    reconciledMetadata.push(reconciled);
    assignedTracks.push({
      trackId: track.id,
      providerTrackId: providerTrack.providerTrackId,
      isrc: providerTrack.isrc,
      audioId: providerTrack.audioId,
      audioFilename: providerTrack.audioFilename,
      fileFormat: providerTrack.fileFormat,
    });
  }

  const assignedIdentity: DistributionProviderAssignedIdentity = { upc: provider.upc, tracks: assignedTracks };
  return { release, trackMetadata: reconciledMetadata, assignedIdentity, raw: provider.raw };
}

function assertAccountReady(context: UpdateContext) {
  if (!context.account.agreement_accepted_at || !context.account.rights_terms_accepted_at) throw new Error("Distribution onboarding is incomplete.");
  if (["setup_required", "restricted", "suspended"].includes(context.account.status)) throw new Error("The distribution account is not currently eligible for catalog changes.");
}

export async function beginDistributionUpdate(form: FormData) {
  const releaseId = text(form, "release_id");
  const context = await loadContext(releaseId);
  assertAccountReady(context);
  if (!context.config.provider_release_id) throw new Error("This release has not been distributed through a provider yet.");
  if (!["delivered", "partially_live", "live", "rejected"].includes(context.config.state)) {
    throw new Error(`A correction cannot start while the release is '${context.config.state}'. Refresh provider status first.`);
  }
  const unresolved = await context.db.from("distribution_provider_operations").select("id,operation_type").eq("owner_id", context.userId).eq("release_id", releaseId).in("state", ["started", "ambiguous"]).limit(1);
  if (unresolved.error) throw new Error(unresolved.error.message);
  if (unresolved.data?.length) throw new Error("An external distribution operation is unresolved. Reconcile it before starting a correction.");

  const baseline = await loadBaseline(context);
  const reconciled = await reconcileAssignedIdentity(context);
  assertSafeDistributedReleaseUpdate({
    release: reconciled.release,
    tracks: context.tracks,
    trackMetadata: reconciled.trackMetadata,
    baseline,
    providerIdentity: reconciled.assignedIdentity,
  });

  const startedAt = new Date().toISOString();
  const providerMetadata = {
    ...object(context.config.provider_metadata),
    assignedIdentity: { ...reconciled.assignedIdentity, syncedAt: startedAt },
    updateMode: {
      active: true,
      baselineSubmissionId: baseline.submissionId,
      baselineVersion: baseline.version,
      previousState: context.config.state,
      startedAt,
    },
  };
  const configWrite = await context.db.from("release_distribution_configs").update({
    state: "needs_attention",
    readiness_score: 0,
    last_validated_at: null,
    provider_metadata: json(providerMetadata),
  }).eq("release_id", releaseId).eq("owner_id", context.userId);
  if (configWrite.error) throw new Error(configWrite.error.message);
  const event = await context.db.from("distribution_events").insert({
    owner_id: context.userId,
    release_id: releaseId,
    submission_id: baseline.submissionId,
    event_type: "distribution.update_started",
    actor_type: "artist",
    provider: context.config.provider,
    payload: json({ baselineVersion: baseline.version, previousState: context.config.state }),
  });
  if (event.error) throw new Error(event.error.message);
  refresh(releaseId);
}

export async function submitDistributionUpdate(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!bool(form, "confirm_submission")) throw new Error("Explicitly approve the correction before resending it to stores.");
  const context = await loadContext(releaseId);
  assertAccountReady(context);
  const updateMode = updateModeFromProviderMetadata(context.config.provider_metadata);
  if (!updateMode.active || !updateMode.baselineSubmissionId) throw new Error("This release is not in correction mode.");
  if (context.config.state !== "ready") throw new Error("Synchronize the corrected provider package and run full preflight before resending the update.");
  if (!context.config.provider_release_id) throw new Error("Provider release identity is missing.");

  const unresolved = await context.db.from("distribution_provider_operations").select("id").eq("owner_id", context.userId).eq("release_id", releaseId).in("operation_type", ["submit", "update_catalog", "takedown"]).in("state", ["started", "ambiguous"]).limit(1);
  if (unresolved.error) throw new Error(unresolved.error.message);
  if (unresolved.data?.length) throw new Error("An external distribution operation is unresolved. Ensemblis will not resend this correction until it is reconciled.");

  const baseline = await loadBaseline(context, updateMode.baselineSubmissionId);
  const reconciled = await reconcileAssignedIdentity(context);
  assertSafeDistributedReleaseUpdate({
    release: reconciled.release,
    tracks: context.tracks,
    trackMetadata: reconciled.trackMetadata,
    baseline,
    providerIdentity: reconciled.assignedIdentity,
  });

  const destination = object(baseline.destinationSnapshot);
  const baselineStoreIds = Array.isArray(destination.storeIds) ? [...new Set(destination.storeIds.map(Number).filter(Number.isFinite))] : [];
  if (!baselineStoreIds.length) throw new Error("The baseline submission has no explicit store set. Ensemblis cannot safely infer which stores should receive this correction.");
  const deliveriesResult = await context.db.from("distribution_deliveries").select("store_id,state").eq("release_id", releaseId).eq("owner_id", context.userId);
  if (deliveriesResult.error) throw new Error(deliveriesResult.error.message);
  const eligible = new Set((deliveriesResult.data ?? []).filter((row) => ["delivered", "live", "rejected", "error"].includes(row.state)).map((row) => Number(row.store_id)).filter(Number.isFinite));
  const storeIds = baselineStoreIds.filter((id) => eligible.has(id));
  if (!storeIds.length) throw new Error("None of the originally submitted stores are currently eligible for an in-place correction. Refresh status or use the takedown workflow.");

  const provider = providerForDistributionAccount(context.account);
  const validation = await provider.validateRelease(context.config.provider_release_id, storeIds);
  if (!validation.ready) throw new Error("The corrected release still fails provider validation. Resolve the provider findings before resending it.");

  const metadataSnapshot = json({
    release: reconciled.release,
    tracks: context.tracks,
    trackMetadata: reconciled.trackMetadata,
    writers: context.writers,
    contributors: context.contributors,
    artistProfiles: context.artistProfiles,
    providerAccountId: context.account.provider_account_id,
    correctionOfSubmissionId: baseline.submissionId,
  });
  const assetSnapshot = json({ artwork_url: reconciled.release.artwork_url, cover_asset: reconciled.release.cover_asset, trackMasters: context.tracks.map((track) => ({ trackId: track.id, audioUrl: track.audio_url })) });
  const submission = await context.db.rpc("create_distribution_submission", {
    p_release_id: releaseId,
    p_provider: context.config.provider,
    p_provider_release_id: context.config.provider_release_id,
    p_metadata_snapshot: metadataSnapshot,
    p_rights_snapshot: context.config.rights,
    p_ai_provenance_snapshot: context.config.ai_provenance,
    p_asset_snapshot: assetSnapshot,
    p_destination_snapshot: json({ mode: "correction", storeIds }),
    p_provider_snapshot: json(validation.raw ?? {}),
  });
  if (submission.error || !submission.data) throw new Error(submission.error?.message ?? "Unable to create immutable correction submission.");
  const submissionId = String(submission.data);
  const operationKey = `update_submit:${releaseId}:${submissionId}`;
  const operation = await context.db.from("distribution_provider_operations").insert({
    owner_id: context.userId,
    release_id: releaseId,
    provider: context.config.provider,
    operation_type: "submit",
    operation_key: operationKey,
    state: "started",
    request_snapshot: json({ submissionId, correctionOfSubmissionId: baseline.submissionId, storeIds, providerReleaseId: context.config.provider_release_id, providerAccountId: context.account.provider_account_id }),
    provider_resource_id: context.config.provider_release_id,
  });
  if (operation.error) throw new Error(operation.error.message);

  try {
    await provider.submitRelease(context.config.provider_release_id, storeIds);
    const submittedAt = new Date().toISOString();
    const metadata = object(context.config.provider_metadata);
    const configWrite = await context.db.from("release_distribution_configs").update({
      state: "submitted",
      submitted_at: submittedAt,
      last_validated_at: submittedAt,
      provider_metadata: json({
        ...metadata,
        updateMode: null,
        assignedIdentity: { ...reconciled.assignedIdentity, syncedAt: submittedAt },
        lastUpdate: { submissionId, correctionOfSubmissionId: baseline.submissionId, submittedAt, storeIds },
      }),
    }).eq("release_id", releaseId).eq("owner_id", context.userId);
    if (configWrite.error) throw new Error(configWrite.error.message);
    const deliveryWrite = await context.db.from("distribution_deliveries").update({ state: "update_pending", last_synced_at: submittedAt, updated_at: submittedAt }).eq("release_id", releaseId).eq("owner_id", context.userId).in("store_id", storeIds.map(String));
    if (deliveryWrite.error) throw new Error(deliveryWrite.error.message);
    const operationWrite = await context.db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json({ accepted: true, correction: true }), completed_at: submittedAt }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    if (operationWrite.error) throw new Error(operationWrite.error.message);
    const event = await context.db.from("distribution_events").insert({
      owner_id: context.userId,
      release_id: releaseId,
      submission_id: submissionId,
      event_type: "distribution.update_submitted",
      actor_type: "artist",
      provider: context.config.provider,
      payload: json({ correctionOfSubmissionId: baseline.submissionId, storeIds }),
    });
    if (event.error) throw new Error(event.error.message);
  } catch (error) {
    await context.db.from("distribution_provider_operations").update({ state: "ambiguous", error: error instanceof Error ? error.message : "Unknown provider update error" }).eq("owner_id", context.userId).eq("provider", context.config.provider).eq("operation_key", operationKey);
    await context.db.from("release_distribution_configs").update({ state: "error" }).eq("release_id", releaseId).eq("owner_id", context.userId);
    refresh(releaseId);
    throw new Error("The provider correction result is ambiguous. Ensemblis will not retry automatically; reconcile provider status before any further distribution mutation.");
  }
  refresh(releaseId);
}
