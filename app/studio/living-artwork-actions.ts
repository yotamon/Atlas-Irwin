"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createLoopKitManifest } from "@/lib/marketing/loop-kit";
import {
  LIVING_ARTWORK_LOOP_ROLE,
  LIVING_ARTWORK_RAW_LOOP_ROLE,
  livingArtworkMotionPreset,
} from "@/lib/marketing/living-artwork";
import {
  enqueueLivingArtworkNormalization,
  enqueueLivingArtworkVisualizer,
} from "@/lib/marketing/living-artwork-media";
import { loadLivingArtworkWorkspace } from "@/lib/marketing/living-artwork-workspace";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";

const uuid = z.uuid();
const MAX_LOOP_BYTES = 150 * 1024 * 1024;

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(input: unknown) {
  return input as Json;
}

async function context(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artistId = uuid.parse(value(form, "artist_id"));
  const artist = await resolveArtistContext(supabase, user, artistId);
  const contentItemId = uuid.parse(value(form, "content_item_id"));
  return { supabase, artist, contentItemId };
}

function refresh(contentItemId: string) {
  revalidatePath(`/studio/create/loop/${contentItemId}`);
  revalidatePath("/studio");
  revalidatePath("/studio/production");
}

export async function prepareLivingArtworkLoopKit(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadLivingArtworkWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  if (!workspace.source) throw new Error("Choose or attach artwork before preparing a loop.");
  const preset = livingArtworkMotionPreset(value(form, "motion_preset"));
  const manifest = createLoopKitManifest({
    artistId: artist.artistId,
    releaseId: workspace.content.release_id,
    contentItemId,
    sourceAssetId: workspace.source.assetId,
    sourceFrameUrl: workspace.source.url,
    motionPreset: preset.id,
    artistContext: [
      workspace.context.brand.visualWorld,
      workspace.context.brand.continuityRules,
      workspace.context.release.visualDirection,
    ].filter(Boolean).join(" "),
    releaseTitle: workspace.context.release.title,
  });

  const marketing = asMarketingClient(createServiceClient());
  const { error: updateError } = await marketing.from("content_items").update({
    visual_prompt: manifest.prompt,
    production_notes: `[living-artwork:v1 preset=${preset.id}] Prepare a seamless short loop from the approved visual source. Use the exact same source as first and last frame.`,
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId);
  if (updateError) throw new Error(updateError.message);

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "loop_kit_prepared",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({
      version: manifest.version,
      sourceAssetId: manifest.sourceAssetId,
      releaseId: manifest.releaseId,
      motionPreset: preset.id,
      aspectRatio: manifest.aspectRatio,
      recommendedDurationSeconds: manifest.recommendedDurationSeconds,
    }),
  });
  if (eventError) throw new Error(eventError.message);
  refresh(contentItemId);
}

export async function importLivingArtworkLoop(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const file = form.get("loop_file");
  if (!(file instanceof File) || file.size <= 0) throw new Error("Choose a generated loop video to import.");
  if (file.size > MAX_LOOP_BYTES) throw new Error("Loop video is too large. Keep the short source loop under 150 MB.");
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (!type.startsWith("video/") && !/\.(mp4|mov|webm|m4v)$/.test(name)) {
    throw new Error("Living Artwork requires a video file.");
  }

  const workspace = await loadLivingArtworkWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const service = createServiceClient();
  const bytes = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const rawId = randomUUID();
  const bucket = "public-media";
  const path = `${artist.userId}/library/marketing/${artist.artistId}/living-artwork/${contentItemId}/raw/${rawId}.mp4`;
  const { error: uploadError } = await service.storage.from(bucket).upload(path, bytes, {
    contentType: type || "video/mp4",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);
  const publicUrl = service.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  const { data: asset, error: assetError } = await service.from("media_assets").insert({
    id: rawId,
    owner_id: artist.userId,
    bucket_name: bucket,
    storage_path: path,
    public_url: publicUrl,
    asset_type: "content_video",
    mime_type: type || "video/mp4",
    file_size: bytes.length,
    content_hash: hash,
    visibility: "public",
    metadata: json({
      title: file.name || "Imported Living Artwork loop",
      description: "External loop imported for Ensemblis seam QC.",
      tags: [`artist:${artist.artistId}`, "living-artwork", "external-loop", "qc-required"],
      artist_id: artist.artistId,
      release_id: workspace.content.release_id,
      content_item_id: contentItemId,
      upload_source: "living-artwork-import",
      source_kind: "external_loop_import",
    }),
  }).select("*").single();
  if (assetError || !asset) throw new Error(assetError?.message || "Imported loop could not be registered.");

  const music = asArtistScopedMusicClient(service);
  const { error: linkError } = await music.from("media_links").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    media_asset_id: asset.id,
    release_id: workspace.content.release_id,
    track_id: workspace.track?.id ?? null,
    content_item_id: contentItemId,
    role: LIVING_ARTWORK_RAW_LOOP_ROLE,
    is_primary: false,
    caption: "Imported Living Artwork loop · awaiting seam QC",
  });
  if (linkError) throw new Error(linkError.message);

  await enqueueLivingArtworkNormalization({
    ownerId: artist.userId,
    artistId: artist.artistId,
    campaignId: workspace.content.campaign_id,
    releaseId: workspace.content.release_id,
    contentItemId,
    rawAssetId: asset.id,
    rawAssetUrl: publicUrl,
    repairPolicy: "none",
  });

  const marketing = asMarketingClient(service);
  await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "loop_imported",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({ source: "external", rawAssetId: asset.id }),
  });
  refresh(contentItemId);
}

export async function repairLivingArtworkLoop(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const assetId = uuid.parse(value(form, "media_asset_id"));
  const workspace = await loadLivingArtworkWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const candidate = workspace.candidateLoopAsset;
  if (!candidate || candidate.id !== assetId || !candidate.public_url) {
    throw new Error("The selected loop is not a current Living Artwork candidate.");
  }
  await enqueueLivingArtworkNormalization({
    ownerId: artist.userId,
    artistId: artist.artistId,
    campaignId: workspace.content.campaign_id,
    releaseId: workspace.content.release_id,
    contentItemId,
    generationRunId: workspace.loopGeneration?.id ?? null,
    rawAssetId: candidate.id,
    rawAssetUrl: candidate.public_url,
    repairPolicy: "auto",
  });
  const marketing = asMarketingClient(createServiceClient());
  await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "loop_repaired",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({ sourceAssetId: candidate.id, mode: "deterministic_boundary_blend" }),
  });
  refresh(contentItemId);
}

export async function approveLivingArtworkLoop(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const assetId = uuid.parse(value(form, "media_asset_id"));
  const service = createServiceClient();
  const music = asArtistScopedMusicClient(service);
  const { data: link, error: linkError } = await music.from("media_links")
    .select("*")
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .eq("content_item_id", contentItemId)
    .eq("media_asset_id", assetId)
    .eq("role", LIVING_ARTWORK_LOOP_ROLE)
    .maybeSingle();
  if (linkError) throw new Error(linkError.message);
  if (!link) throw new Error("Only a normalized Living Artwork loop can be approved.");
  const { data: asset, error: assetError } = await service.from("media_assets")
    .select("*")
    .eq("id", assetId)
    .eq("owner_id", artist.userId)
    .maybeSingle();
  if (assetError || !asset?.public_url) throw new Error(assetError?.message || "Loop asset not found.");

  const { error: demoteError } = await music.from("media_links").update({ is_primary: false })
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .eq("content_item_id", contentItemId)
    .eq("role", LIVING_ARTWORK_LOOP_ROLE);
  if (demoteError) throw new Error(demoteError.message);
  const { error: approveError } = await music.from("media_links").update({ is_primary: true })
    .eq("id", link.id)
    .eq("artist_id", artist.artistId);
  if (approveError) throw new Error(approveError.message);

  const marketing = asMarketingClient(service);
  const { data: content, error: contentError } = await marketing.from("content_items").update({
    asset_url: asset.public_url,
    approval_status: "approved",
  }).eq("id", contentItemId)
    .eq("owner_id", artist.userId)
    .eq("artist_id", artist.artistId)
    .select("campaign_id")
    .single();
  if (contentError || !content) throw new Error(contentError?.message || "Could not approve Living Artwork loop.");
  await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: content.campaign_id,
    event_type: "loop_approved",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({ mediaAssetId: asset.id }),
  });
  refresh(contentItemId);
}

export async function renderLivingArtworkFullTrack(form: FormData) {
  const { artist, contentItemId } = await context(form);
  const workspace = await loadLivingArtworkWorkspace({
    ownerId: artist.userId,
    artistId: artist.artistId,
    contentItemId,
  });
  const loop = workspace.approvedLoopAsset;
  if (!loop?.public_url) throw new Error("Approve the loop before exporting a full-track visualizer.");
  if (!workspace.track?.audio_url) throw new Error("The track has no canonical audio source.");
  const durationSeconds = workspace.track.duration;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The track needs a known duration before full-track rendering.");
  }

  const job = await enqueueLivingArtworkVisualizer({
    ownerId: artist.userId,
    artistId: artist.artistId,
    campaignId: workspace.content.campaign_id,
    releaseId: workspace.content.release_id,
    contentItemId,
    loopAssetId: loop.id,
    loopAssetUrl: loop.public_url,
    audioUrl: workspace.track.audio_url,
    durationMs: Math.round(durationSeconds * 1000),
  });
  const marketing = asMarketingClient(createServiceClient());
  await marketing.from("marketing_events").insert({
    owner_id: artist.userId,
    artist_id: artist.artistId,
    campaign_id: workspace.content.campaign_id,
    event_type: "loop_export_started",
    entity_type: "content_item",
    entity_id: contentItemId,
    payload: json({ mediaJobId: job.id, type: "full_track_vertical" }),
  });
  refresh(contentItemId);
}
