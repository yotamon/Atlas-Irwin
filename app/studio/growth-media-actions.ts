"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { queueVaultAudioAnalysis, vaultAnalysisReadiness } from "@/lib/studio/vault-analysis";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function json(value: unknown) {
  return value as Json;
}
function fileTitle(input: string) {
  return input.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

async function dispatchAnalysis(trackId: string, audioUrl: string) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  if (!vaultAnalysisReadiness().configured) {
    await growth.from("track_vault").update({
      analysis: json({ status: "unavailable", message: "Media Worker is not configured." }),
    }).eq("id", trackId).eq("owner_id", user.id);
    return { queued: false };
  }
  await growth.from("track_vault").update({
    analysis: json({ status: "queued", requested_at: new Date().toISOString() }),
  }).eq("id", trackId).eq("owner_id", user.id);
  try {
    await queueVaultAudioAnalysis({ trackId, audioUrl });
    return { queued: true };
  } catch (error) {
    await growth.from("track_vault").update({
      analysis: json({ status: "failed", message: error instanceof Error ? error.message : "Audio analysis dispatch failed." }),
    }).eq("id", trackId).eq("owner_id", user.id);
    throw error;
  }
}

export async function createVaultTrackFromMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const assetId = z.uuid().parse(value(form, "media_asset_id"));
  const { data: asset, error: assetError } = await supabase.from("media_assets").select("id,public_url,mime_type,duration_ms,metadata").eq("id", assetId).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  if (!asset.mime_type?.startsWith("audio/")) throw new Error("Only audio assets can become Vault tracks.");
  if (!asset.public_url) throw new Error("Vault analysis requires a public media URL.");

  const { data: existing, error: existingError } = await growth.from("track_vault").select("*").eq("owner_id", user.id).eq("media_asset_id", asset.id).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return { id: existing.id, deduplicated: true };

  const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, Json>
    : {};
  const originalName = typeof metadata.original_name === "string" ? metadata.original_name : "Unreleased track";
  const requestedTitle = value(form, "title");
  const title = z.string().min(1).max(300).parse(requestedTitle || fileTitle(originalName));
  const durationSeconds = asset.duration_ms ? Math.round(asset.duration_ms / 1000) : null;
  const { data: track, error } = await growth.from("track_vault").insert({
    owner_id: user.id,
    media_asset_id: asset.id,
    title,
    status: "mastered",
    audio_url: asset.public_url,
    duration_seconds: durationSeconds,
    source: "import",
    release_readiness: durationSeconds ? 75 : 68,
    analysis: json({ status: "pending" }),
  }).select("*").single();
  if (error || !track) throw new Error(error?.message || "Could not add the master to the Vault.");
  await dispatchAnalysis(track.id, asset.public_url);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
  return { id: track.id, deduplicated: false };
}

export async function attachReleaseMasterFromMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const assetId = z.uuid().parse(value(form, "media_asset_id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));

  const [{ data: asset, error: assetError }, { data: release, error: releaseError }, { data: tracks, error: tracksError }] = await Promise.all([
    supabase.from("media_assets").select("id,public_url,mime_type,duration_ms,metadata").eq("id", assetId).eq("owner_id", user.id).single(),
    supabase.from("releases").select("id,title,status,publish_state").eq("id", releaseId).eq("owner_id", user.id).single(),
    supabase.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order").order("created_at"),
  ]);
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  if (releaseError || !release) throw new Error(releaseError?.message || "Release not found.");
  if (tracksError) throw new Error(tracksError.message);
  if (!asset.mime_type?.startsWith("audio/")) throw new Error("The release master must be an audio file.");
  if (!asset.public_url) throw new Error("Music Intelligence requires a public master URL.");

  const durationSeconds = asset.duration_ms ? Math.round(asset.duration_ms / 1000) : null;
  const currentTracks = tracks ?? [];
  let canonicalTrack = currentTracks.find((track) => track.is_primary) ?? currentTracks[0] ?? null;

  if (canonicalTrack) {
    const { data: updated, error } = await supabase.from("tracks").update({
      audio_url: asset.public_url,
      duration: durationSeconds ?? canonicalTrack.duration,
      is_primary: true,
    }).eq("id", canonicalTrack.id).eq("owner_id", user.id).select("*").single();
    if (error || !updated) throw new Error(error?.message || "Could not update the release master.");
    canonicalTrack = updated;
  } else {
    const { data: created, error } = await supabase.from("tracks").insert({
      owner_id: user.id,
      release_id: release.id,
      title: release.title,
      duration: durationSeconds,
      audio_url: asset.public_url,
      display_order: 0,
      is_primary: true,
      notes: "Canonical master attached from the release workspace.",
    }).select("*").single();
    if (error || !created) throw new Error(error?.message || "Could not create the canonical release track.");
    canonicalTrack = created;
  }

  if (currentTracks.length > 1) {
    const otherPrimaryIds = currentTracks.filter((track) => track.id !== canonicalTrack!.id && track.is_primary).map((track) => track.id);
    if (otherPrimaryIds.length) {
      const { error } = await supabase.from("tracks").update({ is_primary: false }).in("id", otherPrimaryIds).eq("owner_id", user.id);
      if (error) throw new Error(error.message);
    }
  }

  const [{ data: linkedVault, error: linkedError }, { data: assetVault, error: assetVaultError }] = await Promise.all([
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("linked_release_id", release.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("media_asset_id", asset.id).limit(1).maybeSingle(),
  ]);
  if (linkedError) throw new Error(linkedError.message);
  if (assetVaultError) throw new Error(assetVaultError.message);

  const vaultStatus = release.publish_state === "live" || release.status === "Live" ? "released" : release.status === "Scheduled" ? "scheduled" : "release_candidate";
  const vaultValues = {
    linked_release_id: release.id,
    media_asset_id: asset.id,
    title: canonicalTrack.title || release.title,
    version: canonicalTrack.version,
    status: vaultStatus as "released" | "scheduled" | "release_candidate",
    audio_url: asset.public_url,
    duration_seconds: durationSeconds ?? canonicalTrack.duration,
    notes: canonicalTrack.notes,
    source: "import" as const,
    release_readiness: 90,
    analysis: json({ status: "pending", requested_from: "release_workspace" }),
  };

  const existingVault = linkedVault ?? assetVault;
  const { data: vaultTrack, error: vaultError } = existingVault
    ? await growth.from("track_vault").update(vaultValues).eq("id", existingVault.id).eq("owner_id", user.id).select("*").single()
    : await growth.from("track_vault").insert({ owner_id: user.id, ...vaultValues }).select("*").single();
  if (vaultError || !vaultTrack) throw new Error(vaultError?.message || "Could not connect Music Intelligence to this release.");

  await dispatchAnalysis(vaultTrack.id, asset.public_url);
  revalidatePath(`/studio/releases/${release.id}`);
  revalidatePath("/studio/releases");
  revalidatePath("/studio/growth");
  revalidatePath("/studio/media");
  revalidatePath("/studio");
  return { trackId: canonicalTrack.id, vaultTrackId: vaultTrack.id };
}

export async function analyzeVaultTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const id = z.uuid().parse(value(form, "id"));
  const { data: track, error } = await growth.from("track_vault").select("id,audio_url,linked_release_id").eq("id", id).eq("owner_id", user.id).single();
  if (error || !track) throw new Error(error?.message || "Vault track not found.");
  if (!track.audio_url) throw new Error("Add an audio URL or upload a master before analysis.");
  await dispatchAnalysis(track.id, track.audio_url);
  revalidatePath("/studio/growth");
  if (track.linked_release_id) revalidatePath(`/studio/releases/${track.linked_release_id}`);
}
