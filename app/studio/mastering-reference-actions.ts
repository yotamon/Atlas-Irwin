"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { deriveMasterReadiness } from "@/lib/mastering/readiness";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { kickMasteringReferenceQueue } from "@/lib/mastering/reference-jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Json } from "@/types/database";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

export async function addCurrentMasterReference(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const mastering = asMasteringClient(supabase);
  const trackId = z.uuid().parse(String(form.get("track_id") ?? ""));

  const trackResult = await growth.from("track_vault")
    .select("id,title,audio_url,media_asset_id,audio_profile,analysis")
    .eq("id", trackId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .single();
  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found.");
  const track = trackResult.data;
  if (!track.audio_url) throw new Error("This track has no canonical master.");

  const readiness = deriveMasterReadiness(track.audio_profile, {
    audioUrl: track.audio_url,
    mediaAssetId: track.media_asset_id,
  });
  if (!["ready", "review"].includes(readiness.status) || readiness.sourceMatchesCurrent === false) {
    throw new Error("Verify the current master before using it as a mastering reference.");
  }

  const map = record(track.audio_profile);
  const inspector = record(map.mastering_inspector);
  const signature = record(inspector.reference_signature);
  if (!Object.keys(signature).length) throw new Error("This master has no reference signature yet.");
  const source = record(map.source_audio);
  const sourceFingerprint = typeof source.audio_sha256 === "string" ? source.audio_sha256 : null;

  const existing = await mastering.from("mastering_references")
    .select("id")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("kind", "approved_master")
    .eq("track_vault_id", track.id)
    .eq("active", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  const values = {
    owner_id: user.id,
    artist_id: artist.artistId,
    kind: "approved_master" as const,
    status: "ready" as const,
    track_vault_id: track.id,
    media_asset_id: track.media_asset_id,
    audio_url: track.audio_url,
    label: track.title,
    reference_signature: json(signature),
    source_fingerprint: sourceFingerprint,
    active: true,
    error: null,
    updated_at: new Date().toISOString(),
  };

  if (existing.data) {
    const update = await mastering.from("mastering_references")
      .update(values)
      .eq("id", existing.data.id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId);
    if (update.error) throw new Error(update.error.message);
  } else {
    const insert = await mastering.from("mastering_references").insert({
      ...values,
      created_at: new Date().toISOString(),
    });
    if (insert.error) throw new Error(insert.error.message);
  }

  revalidatePath(`/studio/music/${track.id}`);
}

export async function createUploadedMasteringReference(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const mastering = asMasteringClient(supabase);
  const assetId = z.uuid().parse(String(form.get("media_asset_id") ?? ""));
  const requestedLabel = String(form.get("label") ?? "").trim();

  const assetResult = await supabase.from("media_assets")
    .select("id,bucket_name,storage_path,public_url,visibility,mime_type,metadata")
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .single();
  if (assetResult.error || !assetResult.data) throw new Error(assetResult.error?.message || "Reference audio was not found.");
  const asset = assetResult.data;
  if (!asset.mime_type?.startsWith("audio/")) throw new Error("Mastering references must be audio files.");
  if (!asset.public_url && (!asset.bucket_name || !asset.storage_path)) {
    throw new Error("Reference analysis requires readable media storage lineage.");
  }

  const metadata = record(asset.metadata);
  const originalName = typeof metadata.original_name === "string" ? metadata.original_name : "Reference";
  const fallbackLabel = originalName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Reference";
  const label = z.string().min(1).max(300).parse(requestedLabel || fallbackLabel);

  const existing = await mastering.from("mastering_references")
    .select("*")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("kind", "uploaded_reference")
    .eq("media_asset_id", asset.id)
    .eq("active", true)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);

  if (existing.data) {
    if (existing.data.status === "failed") {
      const retry = await mastering.from("mastering_references").update({
        status: "pending",
        label,
        audio_url: asset.visibility === "public" ? asset.public_url : null,
        reference_signature: json({}),
        source_fingerprint: null,
        analysis_state: json({ status: "pending", requested_at: new Date().toISOString() }),
        external_job_id: null,
        error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.data.id).eq("owner_id", user.id).eq("artist_id", artist.artistId);
      if (retry.error) throw new Error(retry.error.message);
      await kickMasteringReferenceQueue().catch(() => undefined);
    }
    revalidatePath("/studio/music");
    return { id: existing.data.id, deduplicated: true };
  }

  const inserted = await mastering.from("mastering_references").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    kind: "uploaded_reference",
    status: "pending",
    track_vault_id: null,
    media_asset_id: asset.id,
    audio_url: asset.visibility === "public" ? asset.public_url : null,
    label,
    reference_signature: json({}),
    source_fingerprint: null,
    analysis_state: json({ status: "pending", requested_at: new Date().toISOString() }),
    external_job_id: null,
    active: true,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not create mastering reference.");

  await kickMasteringReferenceQueue().catch(() => undefined);
  revalidatePath("/studio/music");
  return { id: inserted.data.id, deduplicated: false };
}

export async function retryMasteringReference(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const mastering = asMasteringClient(supabase);
  const referenceId = z.uuid().parse(String(form.get("reference_id") ?? ""));
  const update = await mastering.from("mastering_references").update({
    status: "pending",
    reference_signature: json({}),
    source_fingerprint: null,
    analysis_state: json({ status: "pending", requested_at: new Date().toISOString() }),
    external_job_id: null,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", referenceId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("kind", "uploaded_reference")
    .eq("active", true)
    .eq("status", "failed");
  if (update.error) throw new Error(update.error.message);
  await kickMasteringReferenceQueue().catch(() => undefined);
  revalidatePath("/studio/music");
}

export async function removeMasteringReference(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const mastering = asMasteringClient(supabase);
  const referenceId = z.uuid().parse(String(form.get("reference_id") ?? ""));
  const update = await mastering.from("mastering_references")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", referenceId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId);
  if (update.error) throw new Error(update.error.message);
}

