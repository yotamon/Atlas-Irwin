"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { calculateDistributionReadiness, normalizeAiProvenance, type DistributionIssue, type DistributionRights } from "@/lib/distribution/domain";
import { getProviderCatalogIdentity } from "@/lib/distribution/provider-catalog-identity";
import { updateProviderCatalogRelease } from "@/lib/distribution/provider-catalog-update";
import { providerForDistributionAccount } from "@/lib/distribution/provider-account";
import type { ProviderCatalogRelease } from "@/lib/distribution/provider";
import { assertSafeDistributedReleaseUpdate, updateModeFromProviderMetadata, type DistributionProviderAssignedIdentity } from "@/lib/distribution/update-safety";
import { prepareDistributionCatalog as prepareInitialDistributionCatalog } from "./distribution-catalog-action";
import type { Json } from "@/types/database";
import type { DistributionDatabase, DistributionTrackMetadata } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function filenameFromUrl(url: string, fallback: string) {
  try { return new URL(url).pathname.split("/").pop()?.trim() || fallback; } catch { return fallback; }
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

function aiIncludesGeneratedMaterial(ai: ReturnType<typeof normalizeAiProvenance>) {
  return ai.artistIdentity === "ai_persona" || ai.composition.involvement !== "none" || ai.lyrics.involvement !== "none" || ai.vocals.involvement !== "human" || ai.instrumentation.involvement !== "none" || ai.production.involvement !== "none";
}

function creditCheck(
  tracks: Array<{ id: string; title: string; audio_url: string | null }>,
  metadata: DistributionTrackMetadata[],
  writers: Array<{ track_id: string; share: number; publishing_type: string; publisher_name: string | null }>,
  contributors: Array<{ track_id: string }>,
) {
  const issues: DistributionIssue[] = [];
  const metadataByTrack = new Map(metadata.map((row) => [row.track_id, row]));
  for (const track of tracks) {
    const row = metadataByTrack.get(track.id);
    if (!row) issues.push({ code: "credits.track_metadata", title: `Complete distribution metadata for ${track.title}`, detail: "Language, explicit status and track origin are required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    const trackWriters = writers.filter((writer) => writer.track_id === track.id);
    if (!trackWriters.length) issues.push({ code: "credits.writer_missing", title: `Add writer credits for ${track.title}`, detail: "At least one legal composer or lyricist is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    else {
      const share = trackWriters.reduce((sum, writer) => sum + Number(writer.share), 0);
      if (Math.abs(share - 100) > 0.01) issues.push({ code: "credits.writer_share", title: `Writer shares for ${track.title} must total 100%`, detail: `Current total is ${share.toFixed(2)}%.`, severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
      if (trackWriters.some((writer) => writer.publishing_type === "published" && !writer.publisher_name?.trim())) issues.push({ code: "credits.publisher_missing", title: `Add publisher details for ${track.title}`, detail: "Published writers need a publisher name.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    if (!contributors.some((contributor) => contributor.track_id === track.id)) issues.push({ code: "credits.production_missing", title: `Add a production credit for ${track.title}`, detail: "At least one production or engineering contributor is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
  }
  return { ready: issues.length === 0, detail: issues.length ? `${issues.length} catalog issue${issues.length === 1 ? "" : "s"} remain` : "Track metadata, writers and production credits are complete", issues };
}

function refresh(releaseId: string) {
  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}

export async function prepareDistributionCatalog(form: FormData) {
  const releaseId = text(form, "release_id");
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const configProbe = await db.from("release_distribution_configs").select("provider_metadata").eq("release_id", releaseId).eq("owner_id", user.id).maybeSingle();
  if (configProbe.error) throw new Error(configProbe.error.message);
  const updateMode = updateModeFromProviderMetadata(configProbe.data?.provider_metadata);
  if (!updateMode.active) return prepareInitialDistributionCatalog(form);

  const [releaseResult, tracksResult, configResult, accountResult, profilesResult, metadataResult, writersResult, contributorsResult, baselineResult] = await Promise.all([
    db.from("releases").select("*").eq("id", releaseId).eq("owner_id", user.id).single(),
    db.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).single(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").single(),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id),
    db.from("distribution_submissions").select("id,version,metadata_snapshot,asset_snapshot,destination_snapshot").eq("id", updateMode.baselineSubmissionId).eq("release_id", releaseId).eq("owner_id", user.id).single(),
  ]);
  for (const result of [releaseResult, tracksResult, configResult, accountResult, profilesResult, metadataResult, writersResult, contributorsResult, baselineResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const release = releaseResult.data;
  const tracks = tracksResult.data ?? [];
  const config = configResult.data;
  const account = accountResult.data;
  if (!config.provider_release_id) throw new Error("Provider release identity is missing for correction mode.");
  if (!account.agreement_accepted_at || !account.rights_terms_accepted_at || ["setup_required", "restricted", "suspended"].includes(account.status)) throw new Error("Distribution account is not eligible for catalog corrections.");

  const trackIds = new Set(tracks.map((track) => track.id));
  const profiles = (profilesResult.data ?? []).filter((profile) => profile.artist_name === release.artist);
  const metadata = (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const writers = (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const contributors = (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const rights = parseRights(config.rights);
  const ai = normalizeAiProvenance(config.ai_provenance);
  const credits = creditCheck(tracks, metadata, writers, contributors);
  const readiness = calculateDistributionReadiness({ release, tracks, rights, aiProvenance: ai, artistProfiles: profiles, creditsReady: credits });
  if (!readiness.ready) throw new Error("Complete the blocking Ensemblis metadata, rights and credit requirements before synchronizing the correction.");
  if (!release.genre || !release.release_date || !release.artwork_url || !release.upc || !rights?.productCopyrightHolder || !rights.recordingCopyrightHolder || !rights.copyrightYear) throw new Error("Release genre, date, artwork, UPC and copyright identity are required for a distributed-release correction.");

  const providerIdentityRaw = await getProviderCatalogIdentity(account, config.provider_release_id);
  if (providerIdentityRaw.tracks.length !== tracks.length) throw new Error("Provider track count differs from Ensemblis. Use takedown + new release instead.");
  const assignedIdentity: DistributionProviderAssignedIdentity = {
    upc: providerIdentityRaw.upc,
    tracks: tracks.map((track, index) => ({
      trackId: track.id,
      providerTrackId: providerIdentityRaw.tracks[index]?.providerTrackId,
      isrc: providerIdentityRaw.tracks[index]?.isrc,
      audioId: providerIdentityRaw.tracks[index]?.audioId,
      audioFilename: providerIdentityRaw.tracks[index]?.audioFilename,
      fileFormat: providerIdentityRaw.tracks[index]?.fileFormat,
    })),
  };
  assertSafeDistributedReleaseUpdate({
    release,
    tracks,
    trackMetadata: metadata,
    baseline: {
      submissionId: baselineResult.data.id,
      version: baselineResult.data.version,
      metadataSnapshot: baselineResult.data.metadata_snapshot,
      assetSnapshot: baselineResult.data.asset_snapshot,
      destinationSnapshot: baselineResult.data.destination_snapshot,
    },
    providerIdentity: assignedIdentity,
  });

  const metadataByTrack = new Map(metadata.map((row) => [row.track_id, row]));
  const input: ProviderCatalogRelease = {
    providerReleaseId: config.provider_release_id,
    title: release.title,
    artistName: release.artist,
    genre: release.genre,
    label: release.label,
    upc: release.upc,
    previouslyReleased: false,
    originalReleaseDate: null,
    releaseDate: release.release_date,
    metadataLanguageCode: metadata[0]?.metadata_language_code ?? "en",
    copyrightYear: rights.copyrightYear,
    productCopyrightHolder: rights.productCopyrightHolder,
    recordingCopyrightHolder: rights.recordingCopyrightHolder,
    artworkUrl: release.artwork_url,
    artworkFilename: filenameFromUrl(release.artwork_url, `${release.slug || "cover"}.jpg`),
    artistProfiles: profiles.filter((profile) => ["spotify", "apple_music", "soundcloud"].includes(profile.platform)).map((profile) => ({ platform: profile.platform, externalArtistId: profile.status === "confirmed" ? profile.external_artist_id : null })),
    tracks: tracks.map((track) => {
      const row = metadataByTrack.get(track.id);
      if (!row || !track.audio_url) throw new Error(`Track '${track.title}' is missing distribution metadata or master audio.`);
      return {
        title: track.title,
        version: track.version,
        artistName: release.artist,
        audioUrl: track.audio_url,
        audioFilename: filenameFromUrl(track.audio_url, `${track.title}.wav`),
        metadataLanguageCode: row.metadata_language_code,
        audioLanguageCode: row.audio_language_code,
        explicit: row.explicit,
        origin: row.track_origin,
        isrc: row.isrc,
        includesAi: aiIncludesGeneratedMaterial(ai),
        writers: writers.filter((writer) => writer.track_id === track.id).map((writer) => ({ legalName: writer.legal_name, role: writer.role, share: Number(writer.share), publishingType: writer.publishing_type, publisherName: writer.publisher_name })),
        contributors: contributors.filter((contributor) => contributor.track_id === track.id).map((contributor) => ({ name: contributor.name, role: contributor.role })),
      };
    }),
  };

  const baselineAssets = object(baselineResult.data.asset_snapshot);
  const artworkChanged = String(baselineAssets.artwork_url ?? "") !== String(release.artwork_url ?? "");
  const packageHash = createHash("sha256").update(JSON.stringify({ input, artworkChanged })).digest("hex").slice(0, 24);
  const operationKey = `update_catalog:${releaseId}:${packageHash}`;
  const existing = await db.from("distribution_provider_operations").select("*").eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.state === "completed") {
    await providerForDistributionAccount(account).configureRelease(config.provider_release_id, { releaseDate: input.releaseDate, ugcEnabled: rights.ugc.enabled });
    const reset = await db.from("release_distribution_configs").update({ state: "draft", readiness_score: 0, last_validated_at: null }).eq("release_id", releaseId).eq("owner_id", user.id);
    if (reset.error) throw new Error(reset.error.message);
    refresh(releaseId);
    return;
  }
  if (existing.data && ["started", "ambiguous"].includes(existing.data.state)) throw new Error("A previous provider catalog correction is unresolved. Ensemblis will not retry it automatically; reconcile it in Operations first.");
  if (existing.data) {
    const restart = await db.from("distribution_provider_operations").update({ state: "started", request_snapshot: json({ input, artworkChanged }), result_snapshot: {}, provider_resource_id: config.provider_release_id, error: null, started_at: new Date().toISOString(), completed_at: null }).eq("id", existing.data.id).eq("owner_id", user.id);
    if (restart.error) throw new Error(restart.error.message);
  } else {
    const start = await db.from("distribution_provider_operations").insert({ owner_id: user.id, release_id: releaseId, provider: config.provider, operation_type: "update_catalog", operation_key: operationKey, state: "started", request_snapshot: json({ input, artworkChanged }), provider_resource_id: config.provider_release_id });
    if (start.error) throw new Error(start.error.message);
  }

  let updated;
  try {
    updated = await updateProviderCatalogRelease(account, input, { artworkChanged });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : NaN;
    const safeFailure = Number.isFinite(status) && status >= 400 && status < 500;
    await db.from("distribution_provider_operations").update({ state: safeFailure ? "failed_safe" : "ambiguous", error: error instanceof Error ? error.message : "Unknown provider catalog correction error", completed_at: safeFailure ? new Date().toISOString() : null }).eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey);
    throw error;
  }

  const completedAt = new Date().toISOString();
  const operationWrite = await db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: json(updated.raw), provider_resource_id: config.provider_release_id, completed_at: completedAt }).eq("owner_id", user.id).eq("provider", config.provider).eq("operation_key", operationKey);
  if (operationWrite.error) throw new Error(operationWrite.error.message);
  try {
    const configuration = await providerForDistributionAccount(account).configureRelease(config.provider_release_id, { releaseDate: input.releaseDate, ugcEnabled: rights.ugc.enabled });
    const configWrite = await db.from("release_distribution_configs").update({
      state: "draft",
      readiness_score: 0,
      last_validated_at: null,
      provider_metadata: json({ ...object(config.provider_metadata), assignedIdentity, updatePackageHash: packageHash, updatePackagePreparedAt: completedAt, updateSupplyChainConfiguration: configuration }),
    }).eq("release_id", releaseId).eq("owner_id", user.id);
    if (configWrite.error) throw new Error(configWrite.error.message);
  } catch (error) {
    await db.from("release_distribution_configs").update({ state: "needs_attention", provider_metadata: json({ ...object(config.provider_metadata), assignedIdentity, updatePackageHash: packageHash, updateSupplyChainError: error instanceof Error ? error.message : "Unknown supply-chain configuration error" }) }).eq("release_id", releaseId).eq("owner_id", user.id);
    refresh(releaseId);
    throw new Error(`The corrected provider catalog was saved, but supply-chain configuration needs attention: ${error instanceof Error ? error.message : "unknown provider error"}`);
  }
  const event = await db.from("distribution_events").insert({ owner_id: user.id, release_id: releaseId, submission_id: baselineResult.data.id, event_type: "distribution.update_catalog_synchronized", actor_type: "system", provider: config.provider, payload: json({ packageHash, artworkChanged }) });
  if (event.error) throw new Error(event.error.message);
  refresh(releaseId);
}
