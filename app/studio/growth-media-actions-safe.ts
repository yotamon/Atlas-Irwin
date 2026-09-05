"use server";

import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import * as actions from "./growth-media-actions";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function releaseArtistContext(releaseId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const db = asArtistScopedMusicClient(supabase);
  const { data: release, error } = await db
    .from("releases")
    .select("id")
    .eq("id", releaseId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!release) throw new Error("Release not found for the active artist.");
  return { supabase, user, artist };
}

export async function createVaultTrackFromMedia(form: FormData) {
  // The underlying action resolves and persists the active artist explicitly.
  return actions.createVaultTrackFromMedia(form);
}

export async function attachReleaseMasterFromMedia(form: FormData) {
  const releaseId = formValue(form, "release_id");
  if (!releaseId) throw new Error("Release is required when attaching a canonical master.");
  await releaseArtistContext(releaseId);
  return actions.attachReleaseMasterFromMedia(form);
}

export async function analyzeMusicTrack(form: FormData) {
  const vaultTrackId = formValue(form, "id");
  if (!vaultTrackId) throw new Error("Track is required for analysis.");

  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const { data: vaultTrack, error } = await growth
    .from("track_vault")
    .select("id")
    .eq("id", vaultTrackId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!vaultTrack) throw new Error("Track not found for the active artist.");

  return actions.analyzeVaultTrack(form);
}

export async function analyzeReleaseVaultTrack(form: FormData) {
  const releaseId = formValue(form, "release_id");
  const vaultTrackId = formValue(form, "id");
  if (!releaseId || !vaultTrackId) throw new Error("Release and Vault track are required for analysis.");

  const { supabase, user, artist } = await releaseArtistContext(releaseId);
  const growth = asGrowthClient(supabase);
  const { data: vaultTrack, error } = await growth
    .from("track_vault")
    .select("id,linked_release_id")
    .eq("id", vaultTrackId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!vaultTrack || vaultTrack.linked_release_id !== releaseId) {
    throw new Error("Music Intelligence track does not belong to this active-artist release.");
  }

  return actions.analyzeVaultTrack(form);
}