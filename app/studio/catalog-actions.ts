"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
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
  const { supabase } = await requireStudioAdmin();
  const id = z.uuid().parse(value(form, "release_id"));
  const { error } = await supabase
    .from("releases")
    .update({ active_release: true })
    .eq("id", id);
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
  const bucket = visibility === "public" ? "public-media" : "studio-private";
  const storagePath = `${user.id}/releases/${releaseId}/${Date.now()}-${file.name}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const publicUrl =
    visibility === "public"
      ? supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl
      : null;
  const { data: asset, error: assetError } = await supabase
    .from("media_assets")
    .insert({
      owner_id: user.id,
      bucket_name: bucket,
      storage_path: storagePath,
      public_url: publicUrl,
      asset_type: role,
      mime_type: file.type,
      file_size: file.size,
      visibility,
    })
    .select("id")
    .single();
  if (assetError) throw new Error(assetError.message);
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
}
