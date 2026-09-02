"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { calculateDistributionReadiness, normalizeAiProvenance, type DistributionIssue, type DistributionRights } from "@/lib/distribution/domain";
import { providerForDistributionAccount } from "@/lib/distribution/provider-account";
import type { ProviderCatalogRelease } from "@/lib/distribution/provider";
import type { Json } from "@/types/database";
import type { DistributionDatabase, DistributionTrackMetadata } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function asJson(input: unknown): Json {
  return input as Json;
}

function object(input: Json | null | undefined): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function parseRights(input: Json | null | undefined): DistributionRights | null {
  const raw = object(input);
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

function filenameFromUrl(url: string, fallback: string) {
  try {
    return new URL(url).pathname.split("/").pop()?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function todayBerlin() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function aiIncludesGeneratedMaterial(ai: ReturnType<typeof normalizeAiProvenance>) {
  return ai.artistIdentity === "ai_persona" || ai.composition.involvement !== "none" || ai.lyrics.involvement !== "none" || ai.vocals.involvement !== "human" || ai.instrumentation.involvement !== "none" || ai.production.involvement !== "none";
}

function providerErrorStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : null;
}

function creditCheck(
  tracks: Array<{ id: string; title: string; audio_url: string | null }>,
  metadata: DistributionTrackMetadata[],
  writers: Array<{ track_id: string; share: number; publishing_type: string; publisher_name: string | null }>,
  contributors: Array<{ track_id: string }>,
) {
  const issues: DistributionIssue[] = [];
  const byTrack = new Map(metadata.map((row) => [row.track_id, row]));
  for (const track of tracks) {
    const row = byTrack.get(track.id);
    if (!row) issues.push({ code: "credits.track_metadata", title: `Complete distribution metadata for ${track.title}`, detail: "Language, explicit status and track origin are required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    if (row?.isrc && !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(row.isrc.toUpperCase())) issues.push({ code: "credits.isrc_invalid", title: `Check the ISRC for ${track.title}`, detail: "ISRC must use the 12-character CCXXXYYNNNNN format, or be left blank for provider assignment.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    const trackWriters = writers.filter((writer) => writer.track_id === track.id);
    if (!trackWriters.length) issues.push({ code: "credits.writer_missing", title: `Add writer credits for ${track.title}`, detail: "At least one legal composer or lyricist is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    else {
      const share = trackWriters.reduce((sum, writer) => sum + Number(writer.share), 0);
      if (Math.abs(share - 100) > 0.01) issues.push({ code: "credits.writer_share", title: `Writer shares for ${track.title} must total 100%`, detail: `Current total is ${share.toFixed(2)}%.`, severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
      if (trackWriters.some((writer) => writer.publishing_type === "published" && !writer.publisher_name?.trim())) issues.push({ code: "credits.publisher_missing", title: `Add publisher details for ${track.title}`, detail: "Published writers need a publisher name.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    if (!contributors.some((contributor) => contributor.track_id === track.id)) issues.push({ code: "credits.production_missing", title: `Add a production credit for ${track.title}`, detail: "At least one production or engineering contributor is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    if (track.audio_url) {
      const extension = filenameFromUrl(track.audio_url, "").toLowerCase().split(".").pop();
      if (extension !== "wav" && extension !== "flac") issues.push({ code: "audio.lossless_required", title: `Use a lossless master for ${track.title}`, detail: "Distribution package preparation requires a WAV or FLAC master.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
  }
  return { ready: issues.length === 0, detail: issues.length ? `${issues.length} catalog metadata issue${issues.length === 1 ? "" : "s"} remain` : "Track metadata, writers and production credits are complete", issues };
}

export async function prepareDistributionCatalog(form: FormData) {
  const releaseId = value(form, "release_id");
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
  const release = releaseResult.data;
  const tracks = tracksResult.data ?? [];
  const config = configResult.data;
  const account = accountResult.data;
  if (!account?.agreement_accepted_at || !account.rights_terms_accepted_at || ["setup_required", "restricted", "suspended"].includes(account.status)) throw new Error("Complete eligible distribution onboarding before preparing a provider package.");
  const provider = providerForDistributionAccount(account);
  if (config && !["draft", "needs_attention", "ready", "rejected", "error"].includes(config.state)) throw new Error("Provider metadata is locked while the release is in active distribution.");

  const trackIds = new Set(tracks.map((track) => track.id));
  const profiles = (profilesResult.data ?? []).filter((profile) => profile.artist_name === release.artist);
  const metadata = (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const writers = (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const contributors = (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const credits = creditCheck(tracks, metadata, writers, contributors);
  const rights = parseRights(config?.rights);
  const ai = normalizeAiProvenance(config?.ai_provenance);
  const localReadiness = calculateDistributionReadiness({ release, tracks, rights, aiProvenance: ai, artistProfiles: profiles, creditsReady: credits });
  if (!localReadiness.ready) throw new Error("Complete the blocking Ensemblis metadata, rights and credit requirements before preparing the distribution package.");
  if (!release.genre || !release.release_date || !release.artwork_url || !rights?.productCopyrightHolder || !rights.recordingCopyrightHolder || !rights.copyrightYear) throw new Error("Release genre, date, artwork and copyright identity are required before provider preparation.");

  const previous = release.release_date < todayBerlin();
  if (previous && !release.upc) throw new Error("Previously released catalog needs its existing UPC. Ensemblis will never mint a new UPC for an existing release.");
  const metadataByTrack = new Map(metadata.map((row) => [row.track_id, row]));
  const input: ProviderCatalogRelease = {
    providerReleaseId: config?.provider_release_id,
    title: release.title,
    artistName: release.artist,
    genre: release.genre,
    label: release.label,
    upc: release.upc,
    previouslyReleased: previous,
    originalReleaseDate: previous ? release.release_date : null,
    releaseDate: previous ? todayBerlin() : release.release_date,
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

  const packageHash = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);
  const operationType = config?.provider_release_id ? "update_catalog" as const : "prepare_catalog" as const;
  const operationKey = config?.provider_release_id ? `update_catalog:${releaseId}:${packageHash}` : `prepare_catalog:${releaseId}`;
  const existingResult = await db.from("distribution_provider_operations").select("*").eq("owner_id", user.id).eq("provider", "revelator").eq("operation_key", operationKey).maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data;
  const providerConfiguration = { releaseDate: input.releaseDate, ugcEnabled: rights.ugc.enabled };
  if (existing?.state === "completed" && existing.provider_resource_id) {
    await provider.configureRelease(existing.provider_resource_id, providerConfiguration);
    refresh(releaseId);
    return;
  }
  if (existing && ["started", "ambiguous"].includes(existing.state)) throw new Error(operationType === "prepare_catalog" ? "A previous provider creation is unresolved. Ensemblis will not risk creating a duplicate release; reconcile it in Operations." : "A previous provider catalog update is unresolved. Reconcile it before sending another update.");
  const now = new Date().toISOString();
  if (existing) {
    const restart = await db.from("distribution_provider_operations").update({ state: "started", request_snapshot: asJson({ catalog: input, configuration: providerConfiguration, providerAccountId: account.provider_account_id }), result_snapshot: {}, provider_resource_id: config?.provider_release_id ?? null, error: null, started_at: now, completed_at: null }).eq("id", existing.id).eq("owner_id", user.id);
    if (restart.error) throw new Error(restart.error.message);
  } else {
    const start = await db.from("distribution_provider_operations").insert({ owner_id: user.id, release_id: releaseId, provider: "revelator", operation_type: operationType, operation_key: operationKey, state: "started", request_snapshot: asJson({ catalog: input, configuration: providerConfiguration, providerAccountId: account.provider_account_id }), provider_resource_id: config?.provider_release_id ?? null });
    if (start.error) throw new Error(start.error.message);
  }

  let prepared;
  try {
    prepared = await provider.prepareRelease(input);
  } catch (error) {
    const status = providerErrorStatus(error);
    const safeFailure = status != null && status >= 400 && status < 500;
    await db.from("distribution_provider_operations").update({ state: safeFailure ? "failed_safe" : "ambiguous", error: error instanceof Error ? error.message : "Unknown provider catalog error", completed_at: safeFailure ? new Date().toISOString() : null }).eq("owner_id", user.id).eq("provider", "revelator").eq("operation_key", operationKey);
    throw error;
  }

  const completedAt = new Date().toISOString();
  const configWrite = await db.from("release_distribution_configs").upsert({
    release_id: releaseId,
    owner_id: user.id,
    provider: "revelator",
    provider_release_id: prepared.providerReleaseId,
    destinations: config?.destinations ?? asJson({ mode: "all_enabled", storeIds: [] }),
    territories: config?.territories ?? asJson({ mode: "worldwide", countries: [] }),
    rights: config?.rights ?? {},
    ai_provenance: config?.ai_provenance ?? {},
    provider_metadata: asJson({ ...object(config?.provider_metadata), preparedAt: completedAt, packageHash, providerAccountId: account.provider_account_id }),
    state: "draft",
    readiness_score: 0,
    last_validated_at: null,
  }, { onConflict: "release_id" });
  if (configWrite.error) throw new Error(`The provider package was saved as ${prepared.providerReleaseId}, but Ensemblis could not persist the reference. Use Operations recovery. ${configWrite.error.message}`);
  const operationWrite = await db.from("distribution_provider_operations").update({ state: "completed", result_snapshot: asJson(prepared.raw), provider_resource_id: prepared.providerReleaseId, completed_at: completedAt }).eq("owner_id", user.id).eq("provider", "revelator").eq("operation_key", operationKey);
  if (operationWrite.error) throw new Error(operationWrite.error.message);

  try {
    const configurationResult = await provider.configureRelease(prepared.providerReleaseId, providerConfiguration);
    await db.from("release_distribution_configs").update({ provider_metadata: asJson({ ...object(config?.provider_metadata), preparedAt: completedAt, packageHash, providerAccountId: account.provider_account_id, supplyChainConfiguredAt: new Date().toISOString(), supplyChainConfiguration: configurationResult }) }).eq("release_id", releaseId).eq("owner_id", user.id);
  } catch (error) {
    await db.from("release_distribution_configs").update({ state: "needs_attention", provider_metadata: asJson({ ...object(config?.provider_metadata), preparedAt: completedAt, packageHash, providerAccountId: account.provider_account_id, supplyChainError: error instanceof Error ? error.message : "Unknown supply-chain configuration error" }) }).eq("release_id", releaseId).eq("owner_id", user.id);
    refresh(releaseId);
    throw new Error(`The provider catalog package is synchronized, but supply-chain configuration needs attention: ${error instanceof Error ? error.message : "unknown provider error"}`);
  }
  refresh(releaseId);
}

function refresh(releaseId: string) {
  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}
