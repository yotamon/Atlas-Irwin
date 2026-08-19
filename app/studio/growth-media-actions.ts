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

export async function analyzeVaultTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const id = z.uuid().parse(value(form, "id"));
  const { data: track, error } = await growth.from("track_vault").select("id,audio_url").eq("id", id).eq("owner_id", user.id).single();
  if (error || !track) throw new Error(error?.message || "Vault track not found.");
  if (!track.audio_url) throw new Error("Add an audio URL or upload a master before analysis.");
  await dispatchAnalysis(track.id, track.audio_url);
  revalidatePath("/studio/growth");
}
