"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Json } from "@/types/database";
import * as actions from "./growth-media-actions";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown) {
  return value as Json;
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

export async function attachCatalogTrackMasterFromMedia(form: FormData) {
  const releaseId = z.uuid().parse(formValue(form, "release_id"));
  const trackId = z.uuid().parse(formValue(form, "track_id"));
  const assetId = z.uuid().parse(formValue(form, "media_asset_id"));
  const { supabase, user, artist } = await releaseArtistContext(releaseId);
  const music = asArtistScopedMusicClient(supabase);
  const growth = asGrowthClient(supabase);

  const [trackResult, releaseResult, assetResult, linkedVaultResult, assetVaultResult] = await Promise.all([
    music.from("tracks").select("*")
      .eq("id", trackId)
      .eq("release_id", releaseId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
    music.from("releases").select("id,status,publish_state")
      .eq("id", releaseId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
    supabase.from("media_assets").select("id,public_url,mime_type,duration_ms")
      .eq("id", assetId)
      .eq("owner_id", user.id)
      .maybeSingle(),
    growth.from("track_vault").select("*")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("linked_track_id", trackId)
      .maybeSingle(),
    growth.from("track_vault").select("*")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("media_asset_id", assetId)
      .limit(1)
      .maybeSingle(),
  ]);

  if (trackResult.error) throw new Error(trackResult.error.message);
  if (!trackResult.data) throw new Error("Track not found inside this active-artist release.");
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  if (assetResult.error) throw new Error(assetResult.error.message);
  if (!assetResult.data) throw new Error("Media asset not found.");
  if (linkedVaultResult.error) throw new Error(linkedVaultResult.error.message);
  if (assetVaultResult.error) throw new Error(assetVaultResult.error.message);

  const track = trackResult.data;
  const release = releaseResult.data;
  const asset = assetResult.data;
  const linkedVault = linkedVaultResult.data;
  const assetVault = assetVaultResult.data;

  if (!asset.mime_type?.startsWith("audio/")) throw new Error("A track master must be an audio file.");
  if (!asset.public_url) throw new Error("Music Intelligence requires a public master URL.");
  if (assetVault?.linked_track_id && assetVault.linked_track_id !== trackId) {
    throw new Error("This exact master is already attached to another track.");
  }
  if (linkedVault && assetVault && linkedVault.id !== assetVault.id) {
    throw new Error("This master already has separate Music Intelligence. Use a new audio asset for this track.");
  }

  const durationSeconds = asset.duration_ms ? Math.round(asset.duration_ms / 1000) : track.duration;
  const { error: trackUpdateError } = await music.from("tracks").update({
    audio_url: asset.public_url,
    duration: durationSeconds,
  }).eq("id", track.id)
    .eq("release_id", releaseId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (trackUpdateError) throw new Error(trackUpdateError.message);

  const vaultStatus = release.publish_state === "live" || release.status === "Live"
    ? "released"
    : release.status === "Scheduled"
      ? "scheduled"
      : "release_candidate";
  const existingVault = linkedVault ?? assetVault;
  const replacingAsset = Boolean(existingVault?.media_asset_id && existingVault.media_asset_id !== asset.id);
  const values = {
    owner_id: user.id,
    artist_id: artist.artistId,
    linked_release_id: releaseId,
    linked_track_id: track.id,
    media_asset_id: asset.id,
    title: track.title,
    version: track.version,
    status: vaultStatus as "released" | "scheduled" | "release_candidate",
    audio_url: asset.public_url,
    duration_seconds: durationSeconds,
    notes: track.notes,
    source: "import" as const,
    analysis_confidence: replacingAsset ? 0 : existingVault?.analysis_confidence ?? 0,
    audio_profile: replacingAsset ? json({}) : existingVault?.audio_profile ?? json({}),
    analysis: replacingAsset ? json({ status: "pending" }) : existingVault?.analysis ?? json({ status: "pending" }),
  };

  let vaultId: string;
  if (existingVault) {
    const { data: updated, error } = await growth.from("track_vault").update(values)
      .eq("id", existingVault.id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .select("id")
      .single();
    if (error || !updated) throw new Error(error?.message || "Could not update this track master.");
    vaultId = updated.id;
  } else {
    const { data: created, error } = await growth.from("track_vault").insert({
      ...values,
      release_readiness: 72,
    }).select("id").single();
    if (error || !created) throw new Error(error?.message || "Could not create Music Intelligence for this track.");
    vaultId = created.id;
  }

  const analysisForm = new FormData();
  analysisForm.set("id", vaultId);
  await actions.analyzeVaultTrack(analysisForm);

  revalidatePath("/studio/music");
  revalidatePath(`/studio/music/${track.id}`);
  revalidatePath(`/studio/music/${vaultId}`);
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/releases");
  revalidatePath("/studio");
  return { id: vaultId, trackId: track.id };
}

export async function analyzeMusicTrack(form: FormData): Promise<void> {
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

  await actions.analyzeVaultTrack(form);
}

export async function analyzeReleaseVaultTrack(form: FormData): Promise<void> {
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

  await actions.analyzeVaultTrack(form);
}
