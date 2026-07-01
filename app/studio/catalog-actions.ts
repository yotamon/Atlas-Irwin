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
import {
  isCompatibleMediaType,
  MEDIA_TYPES,
  parseTags,
} from "@/lib/studio/media";
import type { Json, MediaAsset, MediaLink } from "@/types/database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

const mediaTypeSchema = z.enum(MEDIA_TYPES);

function nullablePositiveInteger(form: FormData, key: string) {
  const raw = value(form, key);
  if (!raw) return null;
  return z.coerce.number().int().positive().parse(raw);
}

async function clearPrimaryMediaRole(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  link: Pick<MediaLink, "release_id" | "track_id" | "content_item_id" | "role">,
) {
  let query = supabase.from("media_links").update({ is_primary: false }).eq("role", link.role);
  if (link.release_id) query = query.eq("release_id", link.release_id);
  else if (link.track_id) query = query.eq("track_id", link.track_id);
  else if (link.content_item_id) query = query.eq("content_item_id", link.content_item_id);
  const { error } = await query;
  if (error) throw new Error(error.message);
}

async function syncReleaseCover(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  releaseId: string,
) {
  const { data: links, error: linkError } = await supabase
    .from("media_links")
    .select("*")
    .eq("release_id", releaseId)
    .eq("role", "cover")
    .order("is_primary", { ascending: false })
    .order("display_order");
  if (linkError) throw new Error(linkError.message);
  const assetIds = (links ?? []).map((link) => link.media_asset_id);
  const { data: assets, error: assetError } = assetIds.length
    ? await supabase.from("media_assets").select("*").in("id", assetIds)
    : { data: [] as MediaAsset[], error: null };
  if (assetError) throw new Error(assetError.message);
  const publicUrl = (links ?? [])
    .map((link) => (assets ?? []).find((asset) => asset.id === link.media_asset_id)?.public_url)
    .find(Boolean) ?? null;
  const { error } = await supabase.from("releases").update({ artwork_url: publicUrl }).eq("id", releaseId);
  if (error) throw new Error(error.message);
}

async function attachAsset(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  asset: MediaAsset,
  values: {
    releaseId?: string | null;
    trackId?: string | null;
    contentItemId?: string | null;
    role: string;
    isPrimary: boolean;
    altText?: string | null;
    caption?: string | null;
  },
) {
  if (!isCompatibleMediaType(values.role, asset.mime_type)) {
    throw new Error("That role is not compatible with this file format.");
  }
  const targetCount = [values.releaseId, values.trackId, values.contentItemId].filter(Boolean).length;
  if (targetCount !== 1) throw new Error("Choose exactly one media destination.");
  if (values.releaseId) {
    const { data } = await supabase.from("releases").select("id").eq("id", values.releaseId).eq("owner_id", ownerId).maybeSingle();
    if (!data) throw new Error("Release not found.");
  }
  if (values.trackId) {
    const { data } = await supabase.from("tracks").select("id").eq("id", values.trackId).eq("owner_id", ownerId).maybeSingle();
    if (!data) throw new Error("Track not found.");
  }
  if (values.contentItemId) {
    const { data } = await supabase.from("content_items").select("id").eq("id", values.contentItemId).eq("owner_id", ownerId).maybeSingle();
    if (!data) throw new Error("Content item not found.");
  }
  const targetColumn = values.releaseId ? "release_id" : values.trackId ? "track_id" : "content_item_id";
  const targetId = values.releaseId || values.trackId || values.contentItemId!;
  const { data: existing, error: existingError } = await supabase
    .from("media_links")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("media_asset_id", asset.id)
    .eq(targetColumn, targetId)
    .eq("role", values.role)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const linkValues = {
    owner_id: ownerId,
    media_asset_id: asset.id,
    release_id: values.releaseId ?? null,
    track_id: values.trackId ?? null,
    content_item_id: values.contentItemId ?? null,
    role: values.role,
    is_primary: values.isPrimary,
    alt_text: values.altText || null,
    caption: values.caption || null,
  };
  if (values.isPrimary) await clearPrimaryMediaRole(supabase, linkValues);
  const { error } = existing
    ? await supabase.from("media_links").update(linkValues).eq("id", existing.id)
    : await supabase.from("media_links").insert(linkValues);
  if (error) throw new Error(error.message);
  if (values.releaseId && values.role === "cover") await syncReleaseCover(supabase, values.releaseId);
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
  const visibility = "public" as const;
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }
  const bucket = "public-media";
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
    const publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
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
  const contentItemId = value(form, "content_item_id") ? z.uuid().parse(value(form, "content_item_id")) : null;
  const role = mediaTypeSchema.parse(value(form, "role"));
  const { data: asset, error: assetError } = await supabase
    .from("media_assets")
    .select("*")
    .eq("id", mediaAssetId)
    .eq("owner_id", user.id)
    .single();
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  await attachAsset(supabase, user.id, asset, {
    releaseId,
    trackId,
    contentItemId,
    role,
    isPrimary: form.get("is_primary") === "on",
    altText: value(form, "alt_text"),
    caption: value(form, "caption"),
  });
  revalidatePublicCatalog();
  revalidatePath("/studio/media");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
}

export async function createMediaUploadTarget(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const assetType = mediaTypeSchema.parse(value(form, "asset_type"));
  const mimeType = z.string().min(1).max(200).parse(value(form, "mime_type"));
  if (!isCompatibleMediaType(assetType, mimeType)) throw new Error("That role is not compatible with this file format.");
  z.coerce.number().int().positive().max(104857600).parse(value(form, "file_size"));
  const originalName = z.string().min(1).max(500).parse(value(form, "original_name"));
  const safeName = originalName.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  const bucketName = "public-media";
  const storagePath = `${user.id}/library/${crypto.randomUUID()}-${safeName}`;
  const { data, error } = await supabase.storage.from(bucketName).createSignedUploadUrl(storagePath);
  if (error || !data) throw new Error(error?.message || "Could not prepare the secure upload.");
  return { bucketName, storagePath: data.path, token: data.token };
}

export async function discardMediaUpload(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const bucketName = z.literal("public-media").parse(value(form, "bucket_name"));
  const storagePath = z.string().min(1).max(1000).parse(value(form, "storage_path"));
  if (!storagePath.startsWith(`${user.id}/library/`) || storagePath.includes("..")) return;
  await supabase.storage.from(bucketName).remove([storagePath]);
}

export async function registerMediaUpload(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const visibility = "public" as const;
  const bucketName = z.literal("public-media").parse(value(form, "bucket_name"));
  const storagePath = z.string().min(1).max(1000).parse(value(form, "storage_path"));
  if (!storagePath.startsWith(`${user.id}/library/`) || storagePath.includes("..")) {
    throw new Error("Invalid media storage path.");
  }
  const assetType = mediaTypeSchema.parse(value(form, "asset_type"));
  const mimeType = z.string().min(1).max(200).parse(value(form, "mime_type"));
  if (!isCompatibleMediaType(assetType, mimeType)) throw new Error("That role is not compatible with this file format.");
  const fileSize = z.coerce.number().int().positive().max(104857600).parse(value(form, "file_size"));
  const contentHash = value(form, "content_hash") || null;
  if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash)) throw new Error("Invalid media fingerprint.");
  const metadata = {
    original_name: z.string().min(1).max(500).parse(value(form, "original_name")),
    title: z.string().max(200).parse(value(form, "title")),
    description: z.string().max(2000).parse(value(form, "description")),
    tags: parseTags(value(form, "tags")),
    upload_source: "media_library",
    source_kind: "upload",
  };
  const duplicateResult = contentHash
    ? await supabase.from("media_assets").select("*").eq("owner_id", user.id).eq("content_hash", contentHash).eq("visibility", visibility).limit(1).maybeSingle()
    : { data: null, error: null };
  if (duplicateResult.error) throw new Error(duplicateResult.error.message);
  let asset = duplicateResult.data as MediaAsset | null;
  const deduplicated = Boolean(asset);
  if (asset) {
    const { error } = await supabase.storage.from(bucketName).remove([storagePath]);
    if (error) throw new Error(`The duplicate was found, but the temporary upload could not be removed: ${error.message}`);
  } else {
    const publicUrl = visibility === "public"
      ? supabase.storage.from(bucketName).getPublicUrl(storagePath).data.publicUrl
      : null;
    const { data, error } = await supabase.from("media_assets").insert({
      owner_id: user.id,
      bucket_name: bucketName,
      storage_path: storagePath,
      public_url: publicUrl,
      asset_type: assetType,
      mime_type: mimeType,
      file_size: fileSize,
      content_hash: contentHash,
      width: nullablePositiveInteger(form, "width"),
      height: nullablePositiveInteger(form, "height"),
      duration_ms: nullablePositiveInteger(form, "duration_ms"),
      visibility,
      metadata,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "The media record could not be created.");
    asset = data;
  }
  const releaseId = value(form, "release_id") ? z.uuid().parse(value(form, "release_id")) : null;
  if (releaseId) {
    await attachAsset(supabase, user.id, asset, {
      releaseId,
      role: assetType,
      isPrimary: form.get("is_primary") === "on",
    });
  }
  revalidatePublicCatalog();
  revalidatePath("/studio/media");
  if (releaseId) revalidatePath(`/studio/releases/${releaseId}`);
  return { id: asset.id, deduplicated };
}

export async function updateMediaAsset(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "media_asset_id"));
  const { data: asset, error: findError } = await supabase.from("media_assets").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (findError || !asset) throw new Error(findError?.message || "Media asset not found.");
  const assetType = mediaTypeSchema.parse(value(form, "asset_type"));
  if (!isCompatibleMediaType(assetType, asset.mime_type)) throw new Error("That media type is not compatible with the file format.");
  const currentMetadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, Json>
    : {};
  const metadata = {
    ...currentMetadata,
    title: z.string().max(200).parse(value(form, "title")),
    description: z.string().max(2000).parse(value(form, "description")),
    tags: parseTags(value(form, "tags")),
  };
  const { error } = await supabase.from("media_assets").update({ asset_type: assetType, metadata }).eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/media");
  revalidatePublicCatalog();
}

export async function updateMediaLink(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "media_link_id"));
  const { data: link, error: linkError } = await supabase.from("media_links").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (linkError || !link) throw new Error(linkError?.message || "Media assignment not found.");
  const { data: asset, error: assetError } = await supabase.from("media_assets").select("*").eq("id", link.media_asset_id).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  const role = mediaTypeSchema.parse(value(form, "role"));
  if (!isCompatibleMediaType(role, asset.mime_type)) throw new Error("That role is not compatible with this file format.");
  const next = {
    ...link,
    role,
    is_primary: form.get("is_primary") === "on",
    alt_text: value(form, "alt_text") || null,
    caption: value(form, "caption") || null,
  };
  if (next.is_primary) await clearPrimaryMediaRole(supabase, next);
  const { error } = await supabase.from("media_links").update({ role: next.role, is_primary: next.is_primary, alt_text: next.alt_text, caption: next.caption }).eq("id", id);
  if (error) throw new Error(error.message);
  if (link.release_id && (link.role === "cover" || role === "cover")) await syncReleaseCover(supabase, link.release_id);
  revalidatePublicCatalog();
  revalidatePath("/studio/media");
  if (link.release_id) revalidatePath(`/studio/releases/${link.release_id}`);
}

export async function detachMediaAsset(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "media_link_id"));
  const { data: link, error: findError } = await supabase.from("media_links").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (findError || !link) throw new Error(findError?.message || "Media assignment not found.");
  const { error } = await supabase.from("media_links").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  if (link.release_id && link.role === "cover") await syncReleaseCover(supabase, link.release_id);
  revalidatePublicCatalog();
  revalidatePath("/studio/media");
  if (link.release_id) revalidatePath(`/studio/releases/${link.release_id}`);
}

export async function deleteMediaAsset(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "media_asset_id"));
  const { data: asset, error: assetError } = await supabase.from("media_assets").select("*").eq("id", id).eq("owner_id", user.id).single();
  if (assetError || !asset) throw new Error(assetError?.message || "Media asset not found.");
  const { count, error: usageError } = await supabase.from("media_links").select("id", { count: "exact", head: true }).eq("media_asset_id", id).eq("owner_id", user.id);
  if (usageError) throw new Error(usageError.message);
  if (count) throw new Error("Detach this asset everywhere before deleting it from the library.");
  const { error: storageError } = await supabase.storage.from(asset.bucket_name).remove([asset.storage_path]);
  if (storageError) throw new Error(storageError.message);
  const { error } = await supabase.from("media_assets").delete().eq("id", id).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/media");
}

export async function uploadLibraryMedia(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const assetType = z.enum([
    "cover", "alternate_artwork", "canvas_video", "visualizer", "audio_preview",
    "master_audio", "stem", "social_image", "press_image", "lyric_video", "content_video",
  ]).parse(value(form, "asset_type"));
  const visibility = "public" as const;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) throw new Error("Choose a file to upload.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const { data: duplicate, error: lookupError } = await supabase
    .from("media_assets").select("id").eq("owner_id", user.id)
    .eq("content_hash", contentHash).eq("visibility", visibility).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!duplicate) {
    const bucket = "public-media";
    const storagePath = `${user.id}/library/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const publicUrl = supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;
    const { error } = await supabase.from("media_assets").insert({
      owner_id: user.id, bucket_name: bucket, storage_path: storagePath, public_url: publicUrl,
      asset_type: assetType, mime_type: file.type, file_size: file.size, content_hash: contentHash,
      visibility, metadata: { original_name: file.name, upload_source: "media_library" },
    });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/studio/media");
}
