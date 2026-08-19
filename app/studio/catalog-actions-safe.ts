"use server";

import { redirect } from "next/navigation";
import * as actions from "./catalog-actions";

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
  return actions.saveWebsiteDetails(form);
}

export async function moveHomepagePlacement(form: FormData) {
  return actions.moveHomepagePlacement(form);
}

export async function saveHomepagePlacement(form: FormData) {
  return actions.saveHomepagePlacement(form);
}

export async function setActiveRelease(form: FormData) {
  return actions.setActiveRelease(form);
}

export async function linkExternalSoundCloudTrack(form: FormData) {
  return actions.linkExternalSoundCloudTrack(form);
}

export async function dismissSoundCloudTrack(form: FormData) {
  return actions.dismissSoundCloudTrack(form);
}

export async function dismissSpotifyTrack(form: FormData) {
  return actions.dismissSpotifyTrack(form);
}

export async function linkExternalSpotifyTrack(form: FormData) {
  return actions.linkExternalSpotifyTrack(form);
}

export async function createTrackFromSpotify(form: FormData) {
  return actions.createTrackFromSpotify(form);
}

export async function createTrackFromSoundCloud(form: FormData) {
  return actions.createTrackFromSoundCloud(form);
}

export async function moveTrack(form: FormData) {
  return actions.moveTrack(form);
}

export async function getSoundCloudMatchSuggestions(form: FormData) {
  return actions.getSoundCloudMatchSuggestions(form);
}

export async function uploadReleaseMedia(form: FormData) {
  return actions.uploadReleaseMedia(form);
}

export async function attachMediaAsset(form: FormData) {
  return actions.attachMediaAsset(form);
}

export async function createMediaUploadTarget(form: FormData) {
  return actions.createMediaUploadTarget(form);
}

export async function discardMediaUpload(form: FormData) {
  return actions.discardMediaUpload(form);
}

export async function registerMediaUpload(form: FormData) {
  return actions.registerMediaUpload(form);
}

export async function updateMediaAsset(form: FormData) {
  return actions.updateMediaAsset(form);
}

export async function updateMediaLink(form: FormData) {
  return actions.updateMediaLink(form);
}

export async function detachMediaAsset(form: FormData) {
  return actions.detachMediaAsset(form);
}

export async function deleteMediaAsset(form: FormData) {
  return actions.deleteMediaAsset(form);
}

export async function uploadLibraryMedia(form: FormData) {
  return actions.uploadLibraryMedia(form);
}
