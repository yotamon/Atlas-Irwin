"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { kickMediaWorkerQueue } from "@/lib/media-worker/queue";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { vaultAnalysisReadiness } from "@/lib/studio/vault-analysis";
import type { Json } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}
function json(value: unknown) {
  return value as Json;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function fileTitle(input: string) {
  return input.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function hasMusicMap(value: Json) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length);
}
function analysisMatchesAsset(profile: Json, asset: { id: string; public_url: string | null }) {
  if (!hasMusicMap(profile)) return false;
  const map = record(profile);
  if (typeof map.version !== "number" || map.version < 3 || map.source !== "worker") return false;
  const source = record(map.source_audio);
  if (typeof source.media_asset_id === "string") return source.media_asset_id === asset.id;
  return Boolean(asset.public_url) && typeof source.url === "string" && source.url === asset.public_url;
}

async function dispatchAnalysis(
  trackId: string,
  artistId: string,
  audioUrl: string,
  mediaAssetId: string | null,
) {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  if (!vaultAnalysisReadiness().configured) {
    await growth.from("track_vault").update({
      analysis: json({ status: "unavailable", message: "Vercel Sandbox is unavailable in this deployment." }),
    }).eq("id", trackId).eq("owner_id", user.id).eq("artist_id", artistId);
    return { queued: false };
  }
  const requestId = randomUUID();
  const { error } = await growth.from("track_vault").update({
    analysis: json({
      status: "queued",
      request_id: requestId,
      requested_at: new Date().toISOString(),
      source_audio_url: audioUrl,
      source_media_asset_id: mediaAssetId,
      music_intelligence_version: 3,
    }),
  }).eq("id", trackId).eq("owner_id", user.id).eq("artist_id", artistId);
  if (error) throw new Error(error.message);

  // The request is durable before dispatch. A busy worker leaves it queued and the next
  // terminal callback drains it automatically rather than turning contention into failure.
  await kickMediaWorkerQueue().catch(() => undefined);
  return { queued: true };
}

export async function createVaultTrackFromMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const assetId = z.uuid().parse(value(form, "media_asset_id"));
  const { data: asset, error: assetError } = await supabase.from("media_assets").select("id,public_url,mime_type,duration_ms,metadata").eq("id", assetId).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  if (!asset.mime_type?.startsWith("audio/")) throw new Error("Only audio assets can become mastered tracks.");
  if (!asset.public_url) throw new Error("Track Intelligence requires a public media URL.");

  const { data: existing, error: existingError } = await growth.from("track_vault").select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("media_asset_id", asset.id)
    .maybeSingle();
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
    artist_id: artist.artistId,
    media_asset_id: asset.id,
    title,
    status: "mastered",
    audio_url: asset.public_url,
    duration_seconds: durationSeconds,
    source: "import",
    release_readiness: durationSeconds ? 75 : 68,
    analysis: json({ status: "pending" }),
  }).select("*").single();
  if (error || !track) throw new Error(error?.message || "Could not add the master to Music.");
  await dispatchAnalysis(track.id, artist.artistId, asset.public_url, asset.id);
  revalidatePath("/studio/music");
  revalidatePath(`/studio/music/${track.id}`);
  revalidatePath("/studio/growth");
  revalidatePath("/studio");
  return { id: track.id, deduplicated: false };
}

export async function attachReleaseMasterFromMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const assetId = z.uuid().parse(value(form, "media_asset_id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));

  const [assetResult, releaseResult, tracksResult, linkedVaultResult, assetVaultResult] = await Promise.all([
    supabase.from("media_assets").select("id,public_url,mime_type,duration_ms,metadata").eq("id", assetId).eq("owner_id", user.id).single(),
    supabase.from("releases").select("id,title,status,publish_state,artist_id").eq("id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).single(),
    supabase.from("tracks").select("*").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).order("display_order").order("created_at"),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("linked_release_id", releaseId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("media_asset_id", assetId).limit(1).maybeSingle(),
  ]);
  const { data: asset, error: assetError } = assetResult;
  const { data: release, error: releaseError } = releaseResult;
  const { data: tracks, error: tracksError } = tracksResult;
  const { data: linkedVault, error: linkedError } = linkedVaultResult;
  const { data: assetVault, error: assetVaultError } = assetVaultResult;

  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  if (releaseError || !release) throw new Error(releaseError?.message || "Release not found.");
  if (tracksError) throw new Error(tracksError.message);
  if (linkedError) throw new Error(linkedError.message);
  if (assetVaultError) throw new Error(assetVaultError.message);
  if (!asset.mime_type?.startsWith("audio/")) throw new Error("The release master must be an audio file.");
  if (!asset.public_url) throw new Error("Music Intelligence requires a public master URL.");
  if (assetVault?.linked_release_id && assetVault.linked_release_id !== release.id) {
    throw new Error("This exact master is already attached to another release for this artist. Use that release or upload the correct master for this one.");
  }

  const durationSeconds = asset.duration_ms ? Math.round(asset.duration_ms / 1000) : null;
  const currentTracks = tracks ?? [];
  let canonicalTrack = currentTracks.find((track) => track.is_primary) ?? currentTracks[0] ?? null;

  if (canonicalTrack) {
    const { data: updated, error } = await supabase.from("tracks").update({
      audio_url: asset.public_url,
      duration: durationSeconds ?? canonicalTrack.duration,
      is_primary: true,
    }).eq("id", canonicalTrack.id).eq("owner_id", user.id).eq("artist_id", artist.artistId).select("*").single();
    if (error || !updated) throw new Error(error?.message || "Could not update the release master.");
    canonicalTrack = updated;
  } else {
    const { data: created, error } = await supabase.from("tracks").insert({
      owner_id: user.id,
      artist_id: artist.artistId,
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

  const otherPrimaryIds = currentTracks.filter((track) => track.id !== canonicalTrack.id && track.is_primary).map((track) => track.id);
  if (otherPrimaryIds.length) {
    const { error } = await supabase.from("tracks").update({ is_primary: false }).in("id", otherPrimaryIds).eq("owner_id", user.id).eq("artist_id", artist.artistId);
    if (error) throw new Error(error.message);
  }

  const existingVault = assetVault ?? linkedVault;
  if (linkedVault && existingVault && linkedVault.id !== existingVault.id) {
    const { error } = await growth.from("track_vault").update({ linked_release_id: null, status: "hold" })
      .eq("id", linkedVault.id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId);
    if (error) throw new Error(error.message);
  }

  const reusableAnalysis = Boolean(assetVault && analysisMatchesAsset(assetVault.audio_profile, asset));
  const vaultStatus = release.publish_state === "live" || release.status === "Live" ? "released" : release.status === "Scheduled" ? "scheduled" : "release_candidate";
  const vaultValues = {
    artist_id: artist.artistId,
    linked_release_id: release.id,
    media_asset_id: asset.id,
    title: canonicalTrack.title || release.title,
    version: canonicalTrack.version,
    status: vaultStatus as "released" | "scheduled" | "release_candidate",
    audio_url: asset.public_url,
    duration_seconds: durationSeconds ?? canonicalTrack.duration,
    notes: canonicalTrack.notes,
    source: "import" as const,
    release_readiness: reusableAnalysis && assetVault ? assetVault.release_readiness : 72,
    hook_start_seconds: reusableAnalysis && assetVault ? assetVault.hook_start_seconds : null,
    hook_end_seconds: reusableAnalysis && assetVault ? assetVault.hook_end_seconds : null,
    hook_strength: reusableAnalysis && assetVault ? assetVault.hook_strength : 50,
    short_form_potential: reusableAnalysis && assetVault ? assetVault.short_form_potential : 50,
    analysis_confidence: reusableAnalysis && assetVault ? assetVault.analysis_confidence : 0,
    audio_profile: reusableAnalysis && assetVault ? assetVault.audio_profile : json({}),
    analysis: reusableAnalysis && assetVault
      ? assetVault.analysis
      : json({ status: "pending", requested_from: "release_workspace", music_intelligence_version: 3 }),
  };

  const { data: vaultTrack, error: vaultError } = existingVault
    ? await growth.from("track_vault").update(vaultValues).eq("id", existingVault.id).eq("owner_id", user.id).eq("artist_id", artist.artistId).select("*").single()
    : await growth.from("track_vault").insert({ owner_id: user.id, ...vaultValues }).select("*").single();
  if (vaultError || !vaultTrack) throw new Error(vaultError?.message || "Could not connect Music Intelligence to this release.");

  const analysisResult = reusableAnalysis
    ? { queued: false }
    : await dispatchAnalysis(vaultTrack.id, artist.artistId, asset.public_url, asset.id);
  revalidatePath(`/studio/releases/${release.id}`);
  revalidatePath("/studio/releases");
  revalidatePath("/studio/music");
  revalidatePath(`/studio/music/${vaultTrack.id}`);
  revalidatePath("/studio/growth");
  revalidatePath("/studio/media");
  revalidatePath("/studio");
  return { trackId: canonicalTrack.id, vaultTrackId: vaultTrack.id, analysisQueued: analysisResult.queued, analysisReused: reusableAnalysis };
}

export async function analyzeVaultTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const id = z.uuid().parse(value(form, "id"));
  const { data: track, error } = await growth.from("track_vault")
    .select("id,audio_url,media_asset_id,linked_release_id,artist_id")
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .single();
  if (error || !track) throw new Error(error?.message || "Track not found.");
  if (!track.audio_url) throw new Error("Add a master before analysis.");
  await dispatchAnalysis(track.id, artist.artistId, track.audio_url, track.media_asset_id);
  revalidatePath("/studio/music");
  revalidatePath(`/studio/music/${track.id}`);
  revalidatePath("/studio/growth");
  if (track.linked_release_id) revalidatePath(`/studio/releases/${track.linked_release_id}`);
}