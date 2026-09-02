"use server";

import { redirect } from "next/navigation";
import * as actions from "./distribution-actions";

function releaseDestination(form: FormData) {
  const releaseId = String(form.get("release_id") ?? "").trim();
  return releaseId ? `/studio/releases/${encodeURIComponent(releaseId)}/distribution` : "/studio/distribution";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Distribution action could not be completed.";
}

async function runReleaseAction(form: FormData, action: (form: FormData) => Promise<unknown>, notice: string) {
  const destination = releaseDestination(form);
  try {
    await action(form);
  } catch (error) {
    redirect(`${destination}?error=${encodeURIComponent(message(error))}`);
  }
  redirect(`${destination}?notice=${encodeURIComponent(notice)}`);
}

export async function saveDistributionDeclarations(form: FormData) {
  return runReleaseAction(form, actions.saveDistributionDeclarations, "Distribution declarations saved. Run preflight to refresh readiness.");
}

export async function saveDistributionArtistProfile(form: FormData) {
  return runReleaseAction(form, actions.saveDistributionArtistProfile, "Artist profile mapping saved.");
}

export async function saveDistributionTrackMetadata(form: FormData) {
  return runReleaseAction(form, actions.saveDistributionTrackMetadata, "Track distribution metadata saved.");
}

export async function addDistributionTrackWriter(form: FormData) {
  return runReleaseAction(form, actions.addDistributionTrackWriter, "Writer credit added.");
}

export async function removeDistributionTrackWriter(form: FormData) {
  return runReleaseAction(form, actions.removeDistributionTrackWriter, "Writer credit removed.");
}

export async function addDistributionTrackContributor(form: FormData) {
  return runReleaseAction(form, actions.addDistributionTrackContributor, "Production credit added.");
}

export async function removeDistributionTrackContributor(form: FormData) {
  return runReleaseAction(form, actions.removeDistributionTrackContributor, "Production credit removed.");
}

export async function prepareDistributionCatalog(form: FormData) {
  return runReleaseAction(form, actions.prepareDistributionCatalog, "Distribution package prepared and provider catalog synchronized.");
}

export async function runDistributionPreflight(form: FormData) {
  return runReleaseAction(form, actions.runDistributionPreflight, "Distribution preflight completed.");
}

export async function submitDistribution(form: FormData) {
  return runReleaseAction(form, actions.submitDistribution, "Release submitted for distribution.");
}

export async function syncDistributionStatus(form: FormData) {
  return runReleaseAction(form, actions.syncDistributionStatus, "Distribution status refreshed.");
}

export async function requestDistributionTakedown(form: FormData) {
  return runReleaseAction(form, actions.requestDistributionTakedown, "Takedown requested. Ensemblis will track removal status per service.");
}

export async function saveDistributionAccount(form: FormData) {
  try {
    await actions.saveDistributionAccount(form);
  } catch (error) {
    redirect(`/studio/distribution?error=${encodeURIComponent(message(error))}`);
  }
  redirect("/studio/distribution?notice=Distribution%20onboarding%20saved.%20Verification%20can%20continue%20with%20the%20provider.");
}

export async function linkDistributionProviderRelease(form: FormData) {
  const releaseId = String(form.get("release_id") ?? "").trim();
  try {
    await actions.linkDistributionProviderRelease(form);
  } catch (error) {
    redirect(`/studio/distribution/operations?error=${encodeURIComponent(message(error))}`);
  }
  const suffix = releaseId ? `&release=${encodeURIComponent(releaseId)}` : "";
  redirect(`/studio/distribution/operations?notice=Provider%20release%20reconciled${suffix}`);
}
