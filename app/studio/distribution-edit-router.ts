"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import * as core from "./distribution-core-actions";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

const EDITABLE_STATES = new Set(["draft", "needs_attention", "ready", "rejected", "error"]);
const ARTIST_PROFILE_PLATFORMS = new Set(["spotify", "apple_music", "amazon_music", "youtube_music", "soundcloud"]);

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function releaseId(form: FormData) {
  const value = text(form, "release_id");
  if (!value) throw new Error("Release ID is required.");
  return value;
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
      .select("state")
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
  return { db, userId: user.id, artist, release: releaseResult.data };
}

export async function saveDistributionDeclarations(form: FormData) {
  await editableContext(form);
  return core.saveDistributionDeclarations(form);
}

export async function saveDistributionArtistProfile(form: FormData) {
  const context = await editableContext(form);
  const platform = text(form, "platform").toLowerCase();
  if (!ARTIST_PROFILE_PLATFORMS.has(platform)) throw new Error("Unsupported artist profile platform.");

  const externalArtistId = text(form, "external_artist_id");
  const externalUrl = text(form, "external_url");
  const createNew = ["on", "true", "1"].includes(text(form, "create_new").toLowerCase());
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
