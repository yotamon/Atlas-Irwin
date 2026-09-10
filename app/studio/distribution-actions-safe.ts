"use server";

import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { DistributionDatabase } from "@/types/distribution-database";
import * as actions from "./distribution-actions";

function releaseDestination(form: FormData) {
  const releaseId = String(form.get("release_id") ?? "").trim();
  return releaseId ? `/studio/releases/${encodeURIComponent(releaseId)}/distribution` : "/studio/distribution";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Distribution action could not be completed.";
}

async function validateReleaseArtistScope(form: FormData) {
  const releaseId = String(form.get("release_id") ?? "").trim();
  if (!releaseId) throw new Error("Release is required for this distribution action.");

  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = String(form.get("artist_id") ?? "").trim();
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as SupabaseClient<DistributionDatabase>;

  const { data: release, error } = await db
    .from("releases")
    .select("id,artist_id,label,upc")
    .eq("id", releaseId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!release) throw new Error("Release not found for the active artist.");

  form.set("artist_id", artist.artistId);
  return { artist, db, userId: user.id, releaseId, release };
}

async function assertCanonicalIdentity(form: FormData) {
  const context = await validateReleaseArtistScope(form);
  const { data: meta, error } = await context.db.from("distribution_release_metadata")
    .select("product_copyright_line,recording_copyright_line,upc_source")
    .eq("release_id", context.releaseId)
    .eq("owner_id", context.userId)
    .eq("artist_id", context.artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const missing: string[] = [];
  if (!context.release.label?.trim()) missing.push("label / imprint");
  if (!meta?.product_copyright_line.trim()) missing.push("product copyright line");
  if (!meta?.recording_copyright_line.trim()) missing.push("sound-recording copyright line");
  if (meta?.upc_source === "artist" && !context.release.upc) missing.push("UPC/EAN");
  if (!meta) missing.push("release delivery identity");
  if (missing.length) throw new Error(`Complete ${missing.join(", ")} before Ensemblis prepares external distribution work.`);
  return context;
}

async function runReleaseAction(form: FormData, action: (form: FormData) => Promise<unknown>, notice: string) {
  const destination = releaseDestination(form);
  try {
    await validateReleaseArtistScope(form);
    await action(form);
  } catch (error) {
    redirect(`${destination}?error=${encodeURIComponent(message(error))}`);
  }
  redirect(`${destination}?notice=${encodeURIComponent(notice)}`);
}

export async function saveDistributionDeclarations(form: FormData) {
  return runReleaseAction(form, actions.saveDistributionDeclarations, "Distribution declarations saved.");
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
  const destination = releaseDestination(form);
  try {
    await assertCanonicalIdentity(form);
    await actions.prepareDistributionCatalog(form);
  } catch (error) {
    redirect(`${destination}?error=${encodeURIComponent(message(error))}`);
  }
  redirect(`${destination}?notice=${encodeURIComponent("Distribution package synchronized.")}`);
}

export async function runDistributionPreflight(form: FormData) {
  return runReleaseAction(form, actions.runDistributionPreflight, "Distribution preflight completed.");
}

export async function submitDistribution(form: FormData) {
  const destination = releaseDestination(form);
  try {
    await assertCanonicalIdentity(form);
    if (!(form.get("confirm_submission") === "on" || form.get("confirm_submission") === "true" || form.get("confirm_submission") === "1")) {
      throw new Error("Review and explicitly approve the release before distribution.");
    }
    // One artist approval covers the safe preparation sequence. Package synchronization and
    // provider validation remain reversible/preparatory; the final submit call is still guarded
    // by the explicit confirmation above and by the distribution runtime itself.
    await actions.prepareDistributionCatalog(form);
    await actions.runDistributionPreflight(form);
    await actions.submitDistribution(form);
  } catch (error) {
    redirect(`${destination}?error=${encodeURIComponent(message(error))}`);
  }
  redirect(`${destination}?notice=${encodeURIComponent("Release approved and submitted to the selected music services.")}`);
}

export async function syncDistributionStatus(form: FormData) {
  return runReleaseAction(form, actions.syncDistributionStatus, "Distribution status refreshed.");
}

export async function beginDistributionUpdate(form: FormData) {
  return runReleaseAction(form, actions.beginDistributionUpdate, "Correction mode started. Make the allowed metadata changes, then approve the resend.");
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
    await validateReleaseArtistScope(form);
    await actions.linkDistributionProviderRelease(form);
  } catch (error) {
    redirect(`/studio/distribution/operations?error=${encodeURIComponent(message(error))}`);
  }
  const suffix = releaseId ? `&release=${encodeURIComponent(releaseId)}` : "";
  redirect(`/studio/distribution/operations?notice=Provider%20release%20reconciled${suffix}`);
}
