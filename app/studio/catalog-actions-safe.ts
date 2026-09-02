"use server";

import { redirect } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import * as actions from "./catalog-actions";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function assertActiveArtistTargets(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
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
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Track not found for the active artist.");

    if (releaseIds.size && !releaseIds.has(data.release_id)) {
      throw new Error("Track and release must belong to the same active artist context.");
    }
  }

  return { supabase, user, artist };
}

async function guarded<T>(form: FormData, action: (form: FormData) => Promise<T>) {
  await assertActiveArtistTargets(form);
  return action(form);
}

/**
 * Treat release-readiness failures as expected validation, not runtime errors.
 *
 * The canonical publish action deliberately enforces readiness and throws when
 * blockers remain. When invoked from a Server Action form that expected error
 * would otherwise trip the Studio error boundary. Intercept only that known
 * validation case and send the editor back to the readiness panel. Unexpected
 * failures still propagate normally so they remain observable in Vercel.
 */
export async function publishRelease(form: FormData) {
  await assertActiveArtistTargets(form);
  try {
    return await actions.publishRelease(form);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Release is not ready to publish:")
    ) {
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
  return guarded(form, actions.moveHomepagePlacement);
}

export async function saveHomepagePlacement(form: FormData) {
  return guarded(form, actions.saveHomepagePlacement);
}

export async function setActiveRelease(form: FormData) {
  return guarded(form, actions.setActiveRelease);
}

export async function linkExternalSoundCloudTrack(form: FormData) {
  return guarded(form, actions.linkExternalSoundCloudTrack);
}

export async function dismissSoundCloudTrack(form: FormData) {
  return actions.dismissSoundCloudTrack(form);
}

export async function dismissSpotifyTrack(form: FormData) {
  return actions.dismissSpotifyTrack(form);
}

export async function linkExternalSpotifyTrack(form: FormData) {
  return guarded(form, actions.linkExternalSpotifyTrack);
}

export async function createTrackFromSpotify(form: FormData) {
  return guarded(form, actions.createTrackFromSpotify);
}

export async function createTrackFromSoundCloud(form: FormData) {
  return guarded(form, actions.createTrackFromSoundCloud);
}

export async function moveTrack(form: FormData) {
  return guarded(form, actions.moveTrack);
}

export async function getSoundCloudMatchSuggestions(form: FormData) {
  return guarded(form, actions.getSoundCloudMatchSuggestions);
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
