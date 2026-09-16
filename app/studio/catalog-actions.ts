"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { revalidatePublicCatalog } from "@/lib/studio/catalog";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { linkSoundCloudTrack, suggestTrackMatches } from "@/lib/studio/reconciliation";
import * as actions from "./catalog-actions-internal";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function assertActiveArtistTargets(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = formValue(form, "artist_id") || undefined;
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  const db = asArtistScopedMusicClient(supabase);

  const releaseIds = new Set(
    ["release_id", "target_release_id"]
      .map((key) => formValue(form, key))
      .filter(Boolean),
  );
  const trackIds = new Set(
    ["track_id", "target_track_id", "default_track_id"]
      .map((key) => formValue(form, key))
      .filter(Boolean),
  );

  for (const releaseId of releaseIds) {
    const { data, error } = await db
      .from("releases")
      .select("id")
      .eq("id", releaseId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Release not found for the active artist.");
  }

  for (const trackId of trackIds) {
    const { data, error } = await db
      .from("tracks")
      .select("id,release_id")
      .eq("id", trackId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Track not found for the active artist.");

    if (releaseIds.size && !releaseIds.has(data.release_id)) {
      throw new Error("Track and release must belong to the same active artist context.");
    }
  }

  return { supabase, user, artist, db };
}

async function guarded<T>(form: FormData, action: (form: FormData) => Promise<T>) {
  await assertActiveArtistTargets(form);
  return action(form);
}

export async function publishRelease(form: FormData) {
  await assertActiveArtistTargets(form);
  try {
    return await actions.publishRelease(form);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Release is not ready to publish:")) {
      const releaseId = String(form.get("release_id") ?? "").trim();
      const destination = releaseId
        ? `/studio/releases/${encodeURIComponent(releaseId)}?tab=overview&publish=blocked#readiness`
        : "/studio/releases";
      redirect(destination);
    }
    throw error;
  }
}

export async function saveWebsiteDetails(form: FormData) {
  return guarded(form, actions.saveWebsiteDetails);
}

export async function moveHomepagePlacement(form: FormData) {
  const { db, user, artist } = await assertActiveArtistTargets(form);
  const releaseId = formValue(form, "release_id");
  const direction = formValue(form, "direction");
  if (direction !== "up" && direction !== "down") throw new Error("Invalid placement direction.");

  const { data, error } = await db
    .from("homepage_placements")
    .select("id,release_id,display_order")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("enabled", true)
    .order("display_order");
  if (error) throw new Error(error.message);

  const placements = data ?? [];
  const currentIndex = placements.findIndex((item) => item.release_id === releaseId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= placements.length) return;

  const current = placements[currentIndex];
  const target = placements[targetIndex];
  const { error: firstError } = await db
    .from("homepage_placements")
    .update({ display_order: target.display_order })
    .eq("id", current.id)
    .eq("artist_id", artist.artistId);
  if (firstError) throw new Error(firstError.message);
  const { error: secondError } = await db
    .from("homepage_placements")
    .update({ display_order: current.display_order })
    .eq("id", target.id)
    .eq("artist_id", artist.artistId);
  if (secondError) throw new Error(secondError.message);

  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio");
}

export async function saveHomepagePlacement(form: FormData) {
  return guarded(form, actions.saveHomepagePlacement);
}

export async function setActiveRelease(form: FormData) {
  const { db, user, artist } = await assertActiveArtistTargets(form);
  const releaseId = formValue(form, "release_id");

  const { error: clearError } = await db
    .from("releases")
    .update({ active_release: false })
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .neq("id", releaseId);
  if (clearError) throw new Error(clearError.message);

  const { error } = await db
    .from("releases")
    .update({ active_release: true })
    .eq("id", releaseId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);

  revalidatePath("/studio");
  revalidatePath(`/studio/releases/${releaseId}`);
}

export async function linkExternalSoundCloudTrack(form: FormData) {
  const { supabase, user, artist } = await assertActiveArtistTargets(form);
  const externalId = z.uuid().parse(formValue(form, "external_id"));
  const trackId = z.uuid().parse(formValue(form, "track_id"));
  await linkSoundCloudTrack(supabase, user.id, artist.artistId, externalId, trackId);
  revalidatePath("/studio/soundcloud");
  revalidatePath("/studio");
  redirect("/studio/soundcloud?linked=1");
}

export async function dismissSoundCloudTrack(form: FormData) {
  return actions.dismissSoundCloudTrack(form);
}

export async function dismissSpotifyTrack(form: FormData) {
  return actions.dismissSpotifyTrack(form);
}

export async function linkExternalSpotifyTrack(form: FormData) {
  const { supabase, user, artist, db } = await assertActiveArtistTargets(form);
  const externalId = z.uuid().parse(formValue(form, "external_id"));
  const trackId = z.uuid().parse(formValue(form, "track_id"));

  const [{ data: external, error: externalError }, { data: track, error: trackError }] = await Promise.all([
    supabase
      .from("spotify_tracks")
      .select("*")
      .eq("id", externalId)
      .eq("owner_id", user.id)
      .single(),
    db
      .from("tracks")
      .select("id,release_id")
      .eq("id", trackId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
  ]);
  if (externalError || !external) throw new Error(externalError?.message || "Spotify track not found.");
  if (trackError || !track) throw new Error(trackError?.message || "Catalog track not found for the active artist.");

  const { error: updateError } = await db
    .from("tracks")
    .update({ spotify_url: external.spotify_url })
    .eq("id", trackId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const { error: idError } = await db.from("track_external_ids").upsert({
    owner_id: user.id,
    artist_id: artist.artistId,
    track_id: trackId,
    provider: "spotify",
    external_id: external.spotify_id,
    external_url: external.spotify_url,
    raw_metadata: external.raw_track,
    synced_at: new Date().toISOString(),
  }, { onConflict: "track_id,provider" });
  if (idError) throw new Error(idError.message);

  if (external.isrc) {
    const { error: isrcError } = await db.from("track_external_ids").upsert({
      owner_id: user.id,
      artist_id: artist.artistId,
      track_id: trackId,
      provider: "isrc",
      external_id: external.isrc,
      external_url: null,
      raw_metadata: {},
      synced_at: new Date().toISOString(),
    }, { onConflict: "track_id,provider" });
    if (isrcError) throw new Error(isrcError.message);
  }

  const { error: reconcileError } = await supabase
    .from("spotify_tracks")
    .update({
      linked_track_id: trackId,
      linked_release_id: track.release_id,
      reconcile_status: "linked",
      reconciled_at: new Date().toISOString(),
    })
    .eq("id", externalId)
    .eq("owner_id", user.id);
  if (reconcileError) throw new Error(reconcileError.message);

  revalidatePath("/studio/spotify");
  revalidatePath("/studio/data-health");
  revalidatePath(`/studio/releases/${track.release_id}`);
}

export async function createTrackFromSpotify(form: FormData) {
  const { supabase, user, artist, db } = await assertActiveArtistTargets(form);
  const externalId = z.uuid().parse(formValue(form, "external_id"));
  const releaseId = z.uuid().parse(formValue(form, "release_id"));
  const { data: external, error } = await supabase
    .from("spotify_tracks")
    .select("*")
    .eq("id", externalId)
    .eq("owner_id", user.id)
    .single();
  if (error || !external) throw new Error(error?.message || "Spotify track not found.");

  const { data: track, error: insertError } = await db
    .from("tracks")
    .insert({
      owner_id: user.id,
      artist_id: artist.artistId,
      release_id: releaseId,
      title: external.name,
      duration: Math.round(external.duration_ms / 1000),
      spotify_url: external.spotify_url,
      display_order: z.coerce.number().int().nonnegative().parse(formValue(form, "display_order") || "0"),
      is_primary: false,
      notes: `Linked from Spotify ${external.spotify_id}`,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const linked = new FormData();
  linked.set("artist_id", artist.artistId);
  linked.set("external_id", externalId);
  linked.set("track_id", track.id);
  await linkExternalSpotifyTrack(linked);
}

export async function createTrackFromSoundCloud(form: FormData) {
  const { supabase, user, artist, db } = await assertActiveArtistTargets(form);
  const externalId = z.uuid().parse(formValue(form, "external_id"));
  const releaseId = z.uuid().parse(formValue(form, "release_id"));
  const { data: external, error } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", externalId)
    .eq("owner_id", user.id)
    .single();
  if (error || !external) throw new Error(error?.message || "SoundCloud track not found.");

  const { data: track, error: insertError } = await db
    .from("tracks")
    .insert({
      owner_id: user.id,
      artist_id: artist.artistId,
      release_id: releaseId,
      title: external.title,
      duration: external.duration ? Math.round(external.duration / 1000) : null,
      soundcloud_url: external.permalink_url,
      is_primary: false,
      notes: `Linked from SoundCloud ${external.soundcloud_id}`,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  await linkSoundCloudTrack(supabase, user.id, artist.artistId, externalId, track.id);
  revalidatePath("/studio/soundcloud");
  redirect(`/studio/releases/${releaseId}?tab=tracks`);
}

export async function moveTrack(form: FormData) {
  return guarded(form, actions.moveTrack);
}

export async function getSoundCloudMatchSuggestions(form: FormData) {
  const { supabase, user, artist } = await assertActiveArtistTargets(form);
  const id = z.uuid().parse(formValue(form, "id"));
  const { data: external, error } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .single();
  if (error || !external) throw new Error(error?.message || "SoundCloud track not found.");
  return suggestTrackMatches(supabase, user.id, artist.artistId, {
    title: external.title,
    durationSeconds: external.duration ? Math.round(external.duration / 1000) : null,
  });
}

export async function uploadReleaseMedia(form: FormData) {
  return guarded(form, actions.uploadReleaseMedia);
}

export async function attachMediaAsset(form: FormData) {
  return guarded(form, actions.attachMediaAsset);
}

export async function createMediaUploadTarget(form: FormData) {
  return guarded(form, actions.createMediaUploadTarget);
}

export async function discardMediaUpload(form: FormData) {
  return guarded(form, actions.discardMediaUpload);
}

export async function registerMediaUpload(form: FormData) {
  return guarded(form, actions.registerMediaUpload);
}

export async function updateMediaAsset(form: FormData) {
  return actions.updateMediaAsset(form);
}

export async function updateMediaLink(form: FormData) {
  return guarded(form, actions.updateMediaLink);
}

export async function detachMediaAsset(form: FormData) {
  return guarded(form, actions.detachMediaAsset);
}

export async function deleteMediaAsset(form: FormData) {
  return actions.deleteMediaAsset(form);
}

export async function uploadLibraryMedia(form: FormData) {
  return actions.uploadLibraryMedia(form);
}