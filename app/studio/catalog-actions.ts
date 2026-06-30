"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  revalidatePublicCatalog,
  setReleasePublishState,
  upsertHomepagePlacement,
} from "@/lib/studio/catalog";
import {
  dismissExternalTrack,
  linkSoundCloudTrack,
  suggestTrackMatches,
} from "@/lib/studio/reconciliation";
import { calculateReleaseReadiness } from "@/lib/studio/readiness";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

export async function publishRelease(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "release_id"));
  const publishState = z.enum(["draft", "scheduled", "live", "archived"]).parse(
    value(form, "publish_state") || "live",
  );
  const isPublic = form.get("is_public") === "on" || publishState === "live";
  if (publishState === "live") {
    const [releaseResult, tracksResult, placementResult, linksResult, externalResult, contentResult] = await Promise.all([
      supabase.from("releases").select("*").eq("id", id).single(),
      supabase.from("tracks").select("*").eq("release_id", id).order("display_order"),
      supabase.from("homepage_placements").select("*").eq("release_id", id).maybeSingle(),
      supabase.from("media_links").select("*").eq("release_id", id),
      supabase.from("release_external_links").select("*").eq("release_id", id),
      supabase.from("content_items").select("*").eq("release_id", id),
    ]);
    if (!releaseResult.data) throw new Error("Release not found.");
    const assetIds = [...new Set((linksResult.data ?? []).map((link) => link.media_asset_id))];
    const assetsResult = assetIds.length ? await supabase.from("media_assets").select("*").in("id", assetIds) : { data: [] };
    const readiness = calculateReleaseReadiness({
      release: releaseResult.data,
      tracks: tracksResult.data ?? [],
      placement: placementResult.data,
      mediaAssets: assetsResult.data ?? [],
      mediaLinks: linksResult.data ?? [],
      externalLinks: externalResult.data ?? [],
      content: contentResult.data ?? [],
    });
    if (!readiness.canPublish) {
      throw new Error(`Release is not ready to publish: ${readiness.blockers.map((item) => item.label).join(", ")}.`);
    }
  }
  await setReleasePublishState(supabase, id, {
    publish_state: publishState,
    is_public: isPublic,
    published_at: publishState === "live" ? new Date().toISOString() : null,
    status: publishState === "live" ? "Live" : publishState === "scheduled" ? "Scheduled" : "In Progress",
  });
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${id}`);
  revalidatePath("/studio/releases");
}

export async function saveWebsiteDetails(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const parsed = z.object({
    release_id: z.uuid(),
    cover_alt: z.string().trim().max(300),
    cta_label: z.string().trim().max(80),
    cta_href: z.union([z.literal(""), z.url()]),
  }).parse({ release_id: value(form, "release_id"), cover_alt: value(form, "cover_alt"), cta_label: value(form, "cta_label"), cta_href: value(form, "cta_href") });
  const { error } = await supabase.from("releases").update({
    cover_alt: parsed.cover_alt || null, cta_label: parsed.cta_label || null, cta_href: parsed.cta_href || null,
    homepage_eligible: form.get("homepage_eligible") === "on",
  }).eq("id", parsed.release_id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${parsed.release_id}`);
}

export async function moveHomepagePlacement(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const direction = z.enum(["up", "down"]).parse(value(form, "direction"));
  const { data, error } = await supabase.from("homepage_placements").select("*").eq("owner_id", user.id).eq("enabled", true).order("display_order");
  if (error) throw new Error(error.message);
  const currentIndex = (data ?? []).findIndex((item) => item.release_id === releaseId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= (data ?? []).length) return;
  const current = data![currentIndex];
  const target = data![targetIndex];
  const { error: firstError } = await supabase.from("homepage_placements").update({ display_order: target.display_order }).eq("id", current.id);
  if (firstError) throw new Error(firstError.message);
  const { error: secondError } = await supabase.from("homepage_placements").update({ display_order: current.display_order }).eq("id", target.id);
  if (secondError) throw new Error(secondError.message);
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio");
}

export async function saveHomepagePlacement(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const enabled = form.get("enabled") === "on";
  const displayOrder = z.coerce.number().int().nonnegative().parse(
    value(form, "display_order") || "0",
  );
  const defaultTrackId = value(form, "default_track_id") || null;
  const placementType = z
    .enum(["featured", "catalog", "upcoming"])
    .parse(value(form, "placement_type") || "catalog");
  await upsertHomepagePlacement(supabase, user.id, releaseId, {
    enabled,
    display_order: displayOrder,
    default_track_id: defaultTrackId,
    placement_type: placementType,
  });
  if (enabled) {
    await supabase
      .from("releases")
      .update({ homepage_eligible: true, is_featured: placementType === "featured" })
      .eq("id", releaseId);
  }
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/releases");
  revalidatePath("/studio");
}

export async function setActiveRelease(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "release_id"));
  const { error: clearError } = await supabase
    .from("releases")
    .update({ active_release: false })
    .eq("owner_id", user.id)
    .neq("id", id);
  if (clearError) throw new Error(clearError.message);
  const { error } = await supabase
    .from("releases")
    .update({ active_release: true })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio");
  revalidatePath(`/studio/releases/${id}`);
}

export async function linkExternalSoundCloudTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const externalId = z.uuid().parse(value(form, "external_id"));
  const trackId = z.uuid().parse(value(form, "track_id"));
  await linkSoundCloudTrack(supabase, user.id, externalId, trackId);
  revalidatePath("/studio/soundcloud");
  revalidatePath("/studio");
  redirect(`/studio/soundcloud?linked=1`);
}

export async function dismissSoundCloudTrack(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  await dismissExternalTrack(supabase, "soundcloud_tracks", id);
  revalidatePath("/studio/soundcloud");
}

export async function dismissSpotifyTrack(form: FormData) {
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  await dismissExternalTrack(supabase, "spotify_tracks", id);
  revalidatePath("/studio/spotify");
  revalidatePath("/studio/data-health");
}

export async function linkExternalSpotifyTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const externalId = z.uuid().parse(value(form, "external_id"));
  const trackId = z.uuid().parse(value(form, "track_id"));
  const [{ data: external, error: externalError }, { data: track, error: trackError }] = await Promise.all([
    supabase.from("spotify_tracks").select("*").eq("id", externalId).single(),
    supabase.from("tracks").select("*").eq("id", trackId).single(),
  ]);
  if (externalError || !external) throw new Error(externalError?.message || "Spotify track not found.");
  if (trackError || !track || track.owner_id !== user.id) throw new Error(trackError?.message || "Catalog track not found.");
  const { error: updateError } = await supabase.from("tracks").update({ spotify_url: external.spotify_url }).eq("id", trackId);
  if (updateError) throw new Error(updateError.message);
  const { error: idError } = await supabase.from("track_external_ids").upsert({
    owner_id: user.id, track_id: trackId, provider: "spotify", external_id: external.spotify_id,
    external_url: external.spotify_url, raw_metadata: external.raw_track, synced_at: new Date().toISOString(),
  }, { onConflict: "track_id,provider" });
  if (idError) throw new Error(idError.message);
  if (external.isrc) {
    const { error: isrcError } = await supabase.from("track_external_ids").upsert({
      owner_id: user.id, track_id: trackId, provider: "isrc", external_id: external.isrc,
      external_url: null, raw_metadata: {}, synced_at: new Date().toISOString(),
    }, { onConflict: "track_id,provider" });
    if (isrcError) throw new Error(isrcError.message);
  }
  const { error: reconcileError } = await supabase.from("spotify_tracks").update({
    linked_track_id: trackId, linked_release_id: track.release_id,
    reconcile_status: "linked", reconciled_at: new Date().toISOString(),
  }).eq("id", externalId);
  if (reconcileError) throw new Error(reconcileError.message);
  revalidatePath("/studio/spotify");
  revalidatePath("/studio/data-health");
  revalidatePath(`/studio/releases/${track.release_id}`);
}

export async function createTrackFromSpotify(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const externalId = z.uuid().parse(value(form, "external_id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const { data: external, error } = await supabase.from("spotify_tracks").select("*").eq("id", externalId).single();
  if (error || !external) throw new Error(error?.message || "Spotify track not found.");
  const { data: track, error: insertError } = await supabase.from("tracks").insert({
    owner_id: user.id, release_id: releaseId, title: external.name,
    duration: Math.round(external.duration_ms / 1000), spotify_url: external.spotify_url,
    display_order: z.coerce.number().int().nonnegative().parse(value(form, "display_order") || "0"),
    is_primary: false, notes: `Linked from Spotify ${external.spotify_id}`,
  }).select("id").single();
  if (insertError) throw new Error(insertError.message);
  const linked = new FormData();
  linked.set("external_id", externalId);
  linked.set("track_id", track.id);
  await linkExternalSpotifyTrack(linked);
}

export async function createTrackFromSoundCloud(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const externalId = z.uuid().parse(value(form, "external_id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const { data: external, error } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", externalId)
    .single();
  if (error) throw new Error(error.message);
  const { data: track, error: insertError } = await supabase
    .from("tracks")
    .insert({
      owner_id: user.id,
      release_id: releaseId,
      title: external.title,
      duration: external.duration ? Math.round(external.duration / 1000) : null,
      soundcloud_url: external.permalink_url,
      is_primary: false,
      notes: `Linked from SoundCloud ${external.soundcloud_id}`,
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);
  await linkSoundCloudTrack(supabase, user.id, externalId, track.id);
  revalidatePath("/studio/soundcloud");
  redirect(`/studio/releases/${releaseId}?tab=tracks`);
}

export async function moveTrack(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const trackId = z.uuid().parse(value(form, "track_id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const direction = z.enum(["up", "down"]).parse(value(form, "direction"));
  const { data, error } = await supabase.from("tracks").select("id,display_order").eq("owner_id", user.id).eq("release_id", releaseId).order("display_order").order("created_at");
  if (error) throw new Error(error.message);
  const currentIndex = (data ?? []).findIndex((item) => item.id === trackId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= (data ?? []).length) return;
  const current = data![currentIndex];
  const target = data![targetIndex];
  const { error: currentError } = await supabase.from("tracks").update({ display_order: target.display_order }).eq("id", current.id);
  if (currentError) throw new Error(currentError.message);
  const { error: targetError } = await supabase.from("tracks").update({ display_order: current.display_order }).eq("id", target.id);
  if (targetError) throw new Error(targetError.message);
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${releaseId}`);
}

export async function getSoundCloudMatchSuggestions(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "id"));
  const { data: external, error } = await supabase
    .from("soundcloud_tracks")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return suggestTrackMatches(supabase, user.id, {
    title: external.title,
    durationSeconds: external.duration ? Math.round(external.duration / 1000) : null,
  });
}

export async function uploadReleaseMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const role = z.string().parse(value(form, "role"));
  const visibility = value(form, "visibility") === "public" ? "public" : "private";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }
  if (visibility === "public" && form.get("confirm_public") !== "on") {
    throw new Error("Confirm that this asset is intentionally public.");
  }
  const bucket = visibility === "public" ? "public-media" : "studio-private";
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const { data: existing, error: lookupError } = await supabase
    .from("media_assets")
    .select("*")
    .eq("owner_id", user.id)
    .eq("content_hash", contentHash)
    .eq("visibility", visibility)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  let asset = existing;
  if (!asset) {
    const storagePath = `${user.id}/releases/${releaseId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const publicUrl = visibility === "public"
      ? supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl
      : null;
    const { data: created, error: assetError } = await supabase
      .from("media_assets")
      .insert({
        owner_id: user.id, bucket_name: bucket, storage_path: storagePath,
        public_url: publicUrl, asset_type: role, mime_type: file.type,
        file_size: file.size, visibility, content_hash: contentHash,
        metadata: { original_name: file.name, upload_source: "release_workspace" },
      })
      .select("*")
      .single();
    if (assetError) throw new Error(assetError.message);
    asset = created;
  }
  if (!asset) throw new Error("The media asset could not be created.");
  const publicUrl = asset.public_url;
  const isPrimary = form.get("is_primary") === "on";
  const { error: linkError } = await supabase.from("media_links").insert({
    owner_id: user.id,
    media_asset_id: asset.id,
    release_id: releaseId,
    role,
    is_primary: isPrimary,
    alt_text: value(form, "alt_text") || null,
  });
  if (linkError) throw new Error(linkError.message);
  if (role === "cover" && publicUrl) {
    await supabase.from("releases").update({ artwork_url: publicUrl }).eq("id", releaseId);
  }
  revalidatePublicCatalog();
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/media");
}

export async function attachMediaAsset(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const mediaAssetId = z.uuid().parse(value(form, "media_asset_id"));
  const releaseId = value(form, "release_id") ? z.uuid().parse(value(form, "release_id")) : null;
  const trackId = value(form, "track_id") ? z.uuid().parse(value(form, "track_id")) : null;
  if (!releaseId && !trackId) throw new Error("Choose a release or track.");
  const role = z.string().min(1).max(80).parse(value(form, "role"));
  const { data: existing } = await supabase
    .from("media_links")
    .select("id")
    .eq("owner_id", user.id)
    .eq("media_asset_id", mediaAssetId)
    .eq(trackId ? "track_id" : "release_id", trackId || releaseId!)
    .eq("role", role)
    .maybeSingle();
  if (!existing) {
    const { error } = await supabase.from("media_links").insert({
      owner_id: user.id, media_asset_id: mediaAssetId, release_id: releaseId,
      track_id: trackId, role, is_primary: form.get("is_primary") === "on",
    });
    if (error) throw new Error(error.message);
  }
  revalidatePublicCatalog();
  revalidatePath("/studio/media");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
}

export async function uploadLibraryMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const assetType = z.enum([
    "cover", "alternate_artwork", "canvas_video", "visualizer", "audio_preview",
    "master_audio", "stem", "social_image", "press_image", "lyric_video", "content_video",
  ]).parse(value(form, "asset_type"));
  const visibility = z.enum(["public", "private"]).parse(value(form, "visibility") || "private");
  if (["master_audio", "stem"].includes(assetType) && visibility === "public") {
    throw new Error("Masters and stems must remain private.");
  }
  if (visibility === "public" && form.get("confirm_public") !== "on") {
    throw new Error("Confirm that this asset is intentionally public.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose a file to upload.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const { data: duplicate, error: lookupError } = await supabase
    .from("media_assets").select("id").eq("owner_id", user.id)
    .eq("content_hash", contentHash).eq("visibility", visibility).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!duplicate) {
    const bucket = visibility === "public" ? "public-media" : "studio-private";
    const storagePath = `${user.id}/library/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const publicUrl = visibility === "public" ? supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl : null;
    const { error } = await supabase.from("media_assets").insert({
      owner_id: user.id, bucket_name: bucket, storage_path: storagePath, public_url: publicUrl,
      asset_type: assetType, mime_type: file.type, file_size: file.size, content_hash: contentHash,
      visibility, metadata: { original_name: file.name, upload_source: "media_library" },
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/media");
}
