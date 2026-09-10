"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import * as core from "./distribution-core-actions";
import type { Json } from "@/types/database";
import type { DistributionDatabase, ReleaseDistributionConfig } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

const EDITABLE_STATES = new Set(["draft", "needs_attention", "ready", "rejected", "error"]);
const ARTIST_PROFILE_PLATFORMS = new Set(["spotify", "apple_music", "amazon_music", "youtube_music", "soundcloud"]);
const AI_INVOLVEMENT = new Set(["none", "assisted", "generated"]);

type TerritorySelection = { mode: "worldwide" | "include"; countries: string[] };

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function checked(form: FormData, key: string) {
  return ["on", "true", "1"].includes(text(form, key).toLowerCase());
}

function json(value: unknown): Json {
  return value as Json;
}

function releaseId(form: FormData) {
  const value = text(form, "release_id");
  if (!value) throw new Error("Release ID is required.");
  return value;
}

function normalizeTerritoryCodes(values: string[]) {
  const countries = [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
  const invalid = countries.find((country) => !/^[A-Z]{2}$/.test(country));
  if (invalid) throw new Error(`Territory '${invalid}' must be a two-letter ISO country code.`);
  return countries;
}

function territorySelection(form: FormData): TerritorySelection | null {
  if (!form.has("territory_mode") && !form.has("territory_codes") && !form.has("territory_country")) return null;
  const mode = text(form, "territory_mode") === "include" ? "include" as const : "worldwide" as const;
  const countries = normalizeTerritoryCodes([
    ...form.getAll("territory_country").map(String),
    ...text(form, "territory_codes").split(/[\s,;]+/),
  ]);
  if (mode === "include" && !countries.length) throw new Error("Choose at least one territory, or distribute worldwide.");
  return { mode, countries: mode === "include" ? countries : [] };
}

function existingTerritories(value: Json | null | undefined): TerritorySelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { mode: "worldwide", countries: [] };
  const raw = value as Record<string, unknown>;
  const countries = Array.isArray(raw.countries) ? normalizeTerritoryCodes(raw.countries.map(String)) : [];
  return raw.mode === "include" && countries.length ? { mode: "include", countries } : { mode: "worldwide", countries: [] };
}

async function editableContext(form: FormData) {
  const id = releaseId(form);
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = text(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;

  const [releaseResult, configResult] = await Promise.all([
    db.from("releases")
      .select("id,artist")
      .eq("id", id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
    db.from("release_distribution_configs")
      .select("*")
      .eq("release_id", id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
  ]);

  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  if (configResult.error) throw new Error(configResult.error.message);
  if (configResult.data && !EDITABLE_STATES.has(configResult.data.state)) {
    throw new Error(`Distribution metadata is locked while the release is '${configResult.data.state}'. Start a correction workflow before editing a distributed release.`);
  }

  form.set("artist_id", artist.artistId);
  return { db, userId: user.id, artist, release: releaseResult.data, config: configResult.data as ReleaseDistributionConfig | null };
}

function refreshDistribution(releaseId: string) {
  revalidatePath("/studio/distribution");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
  revalidatePath("/studio/needs-you");
  revalidatePath("/studio");
}

export async function saveDistributionDeclarations(form: FormData) {
  const context = await editableContext(form);
  const id = releaseId(form);
  const previous = context.config;
  const territories = territorySelection(form) ?? existingTerritories(previous?.territories);
  const year = Number(text(form, "copyright_year"));
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear() + 1) {
    throw new Error("Enter a valid copyright year.");
  }

  const involvement = (key: string) => {
    const value = text(form, key);
    return AI_INVOLVEMENT.has(value) ? value : "none";
  };
  const vocals = text(form, "vocals_ai");
  const vocalInvolvement = ["human", "mixed", "synthetic"].includes(vocals) ? vocals : "human";
  const artistIdentity = text(form, "artist_identity");
  const normalizedArtistIdentity = ["human", "virtual", "ai_persona"].includes(artistIdentity) ? artistIdentity : "human";
  const ugcEnabled = checked(form, "ugc_enabled");

  const rights = {
    masterRightsConfirmed: checked(form, "master_rights_confirmed"),
    compositionRightsConfirmed: checked(form, "composition_rights_confirmed"),
    samplesCleared: checked(form, "samples_cleared"),
    contributorPermissionsConfirmed: checked(form, "contributor_permissions_confirmed"),
    aiDeclarationConfirmed: checked(form, "ai_declaration_confirmed"),
    productCopyrightHolder: text(form, "product_copyright_holder"),
    recordingCopyrightHolder: text(form, "recording_copyright_holder"),
    copyrightYear: year,
    territories: territories.mode === "worldwide" ? "worldwide" : territories.countries,
    ugc: {
      enabled: ugcEnabled,
      exclusiveMasterConfirmed: ugcEnabled && checked(form, "ugc_exclusive_master_confirmed"),
      noUnlicensedSamplesConfirmed: ugcEnabled && checked(form, "ugc_no_unlicensed_samples_confirmed"),
      noNonExclusiveBeatsConfirmed: ugcEnabled && checked(form, "ugc_no_nonexclusive_beats_confirmed"),
      noUnauthorizedVoicesConfirmed: ugcEnabled && checked(form, "ugc_no_unauthorized_voices_confirmed"),
    },
  };
  const optionalProvider = (key: string) => text(form, key) || undefined;
  const aiProvenance = {
    artistIdentity: normalizedArtistIdentity,
    composition: { involvement: involvement("composition_ai"), provider: optionalProvider("composition_provider") },
    lyrics: { involvement: involvement("lyrics_ai"), provider: optionalProvider("lyrics_provider") },
    vocals: {
      involvement: vocalInvolvement,
      clonedVoice: checked(form, "cloned_voice"),
      authorizationConfirmed: checked(form, "voice_authorization_confirmed"),
      provider: optionalProvider("vocals_provider"),
    },
    instrumentation: { involvement: involvement("instrumentation_ai"), provider: optionalProvider("instrumentation_provider") },
    production: { involvement: involvement("production_ai"), provider: optionalProvider("production_provider") },
  };
  const destinationMode = text(form, "destination_mode") === "custom" ? "custom" : "all_enabled";
  const storeIds = [...new Set(form.getAll("store_id").map(Number).filter(Number.isFinite))];

  const result = await context.db.from("release_distribution_configs").upsert({
    release_id: id,
    owner_id: context.userId,
    artist_id: context.artist.artistId,
    provider: previous?.provider ?? "revelator",
    provider_release_id: previous?.provider_release_id ?? null,
    state: previous?.state ?? "draft",
    destinations: json({ mode: destinationMode, storeIds }),
    territories: json(territories),
    rights: json(rights),
    ai_provenance: json(aiProvenance),
    provider_metadata: previous?.provider_metadata ?? {},
    readiness_score: 0,
    last_validated_at: null,
  }, { onConflict: "release_id" });
  if (result.error) throw new Error(result.error.message);

  const event = await context.db.from("distribution_events").insert({
    owner_id: context.userId,
    artist_id: context.artist.artistId,
    release_id: id,
    submission_id: null,
    event_type: "distribution.declarations_saved",
    actor_type: "artist",
    provider: previous?.provider ?? "revelator",
    payload: json({ territoryMode: territories.mode, countries: territories.countries, destinationMode, storeCount: storeIds.length, ugcEnabled }),
  });
  if (event.error) throw new Error(event.error.message);
  refreshDistribution(id);
}

export async function saveDistributionArtistProfile(form: FormData) {
  const context = await editableContext(form);
  const platform = text(form, "platform").toLowerCase();
  if (!ARTIST_PROFILE_PLATFORMS.has(platform)) throw new Error("Unsupported artist profile platform.");

  const externalArtistId = text(form, "external_artist_id");
  const externalUrl = text(form, "external_url");
  const createNew = checked(form, "create_new");
  if (!createNew && !externalArtistId) throw new Error("Choose an existing artist profile or explicitly mark this as a new profile.");

  const result = await context.db.from("distribution_artist_profiles").upsert({
    owner_id: context.userId,
    artist_id: context.artist.artistId,
    artist_name: context.artist.artistName,
    platform,
    external_artist_id: createNew ? null : externalArtistId,
    external_url: createNew ? null : externalUrl || null,
    status: createNew ? "create_new" : "confirmed",
    confirmed_at: new Date().toISOString(),
  }, { onConflict: "artist_id,platform" });
  if (result.error) throw new Error(result.error.message);
  refreshDistribution(releaseId(form));
}

export async function saveDistributionTrackMetadata(form: FormData) {
  await editableContext(form);
  return core.saveDistributionTrackMetadata(form);
}

export async function addDistributionTrackWriter(form: FormData) {
  await editableContext(form);
  return core.addDistributionTrackWriter(form);
}

export async function removeDistributionTrackWriter(form: FormData) {
  await editableContext(form);
  return core.removeDistributionTrackWriter(form);
}

export async function addDistributionTrackContributor(form: FormData) {
  await editableContext(form);
  return core.addDistributionTrackContributor(form);
}

export async function removeDistributionTrackContributor(form: FormData) {
  await editableContext(form);
  return core.removeDistributionTrackContributor(form);
}
