"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

const required = z.string().trim().min(1).max(300);
const number = z.coerce.number().int().nonnegative().default(0);
function value(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function nullable(form: FormData, key: string) { return value(form, key) || null; }

async function contentContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id") || null;
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, z.uuid().parse(requestedArtistId))
    : await resolveDefaultArtistContext(supabase, user);
  return { supabase, artist };
}

async function assertRelease(
  supabase: Awaited<ReturnType<typeof requireStudioAdmin>>["supabase"],
  ownerId: string,
  artistId: string,
  releaseId: string | null,
) {
  if (!releaseId) return;
  const { data, error } = await asArtistScopedMusicClient(supabase).from("releases").select("id")
    .eq("id", z.uuid().parse(releaseId)).eq("owner_id", ownerId).eq("artist_id", artistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Release does not belong to the active artist.");
}

export async function saveContent(form: FormData) {
  const { supabase, artist } = await contentContext(form);
  const marketing = asMarketingClient(supabase);
  const id = value(form, "id");
  const releaseId = nullable(form, "release_id");
  await assertRelease(supabase, artist.userId, artist.artistId, releaseId);
  const row = {
    owner_id: artist.userId,
    artist_id: artist.artistId,
    release_id: releaseId,
    title: required.parse(value(form, "title")),
    platform: required.parse(value(form, "platform")),
    format: required.parse(value(form, "format")),
    status: required.parse(value(form, "status")),
    goal: required.parse(value(form, "goal")),
    scheduled_at: nullable(form, "scheduled_at"),
    published_at: nullable(form, "published_at"),
    audio_timestamp_start: value(form, "audio_timestamp_start") ? number.parse(value(form, "audio_timestamp_start")) : null,
    audio_timestamp_end: value(form, "audio_timestamp_end") ? number.parse(value(form, "audio_timestamp_end")) : null,
    hook_text: nullable(form, "hook_text"),
    caption: nullable(form, "caption"),
    cta: nullable(form, "cta"),
    visual_prompt: nullable(form, "visual_prompt"),
    production_notes: nullable(form, "production_notes"),
    asset_url: nullable(form, "asset_url"),
    performance_notes: nullable(form, "performance_notes"),
  };
  const mutation = id
    ? marketing.from("content_items").update(row).eq("id", z.uuid().parse(id)).eq("owner_id", artist.userId).eq("artist_id", artist.artistId)
    : marketing.from("content_items").insert(row);
  const { error } = await mutation;
  if (error) throw new Error(error.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/production");
  revalidatePath("/studio/calendar");
}

export async function updateContentStatus(form: FormData) {
  const { supabase, artist } = await contentContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const status = required.parse(value(form, "status"));
  const { error } = await asMarketingClient(supabase).from("content_items")
    .update({ status }).eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/production");
  revalidatePath("/studio/calendar");
}

export async function duplicateContent(form: FormData) {
  const { supabase, artist } = await contentContext(form);
  const marketing = asMarketingClient(supabase);
  const id = z.uuid().parse(value(form, "id"));
  const { data, error } = await marketing.from("content_items").select("*")
    .eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId).single();
  if (error) throw new Error(error.message);
  const { id: _id, created_at: _created, updated_at: _updated, ...copy } = data;
  void _id; void _created; void _updated;
  const { error: insertError } = await marketing.from("content_items").insert({
    ...copy,
    owner_id: artist.userId,
    artist_id: artist.artistId,
    title: `${copy.title} (copy)`,
    status: "Draft",
    published_at: null,
  });
  if (insertError) throw new Error(insertError.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/production");
}

export async function deleteStudioRecord(form: FormData) {
  const { supabase, artist } = await contentContext(form);
  const id = z.uuid().parse(value(form, "id"));
  const table = z.literal("content_items").parse(value(form, "table"));
  void table;
  const { error } = await asMarketingClient(supabase).from("content_items").delete()
    .eq("id", id).eq("owner_id", artist.userId).eq("artist_id", artist.artistId);
  if (error) throw new Error(error.message);
  revalidatePath("/studio/content");
  revalidatePath("/studio/production");
  revalidatePath("/studio/calendar");
}
