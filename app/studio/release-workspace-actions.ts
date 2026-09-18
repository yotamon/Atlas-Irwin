"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { TemplateContentGenerationProvider } from "@/lib/studio/generation";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";

const required = z.string().trim().min(1).max(300);
const nonnegative = z.coerce.number().int().nonnegative();

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function nullable(form: FormData, key: string) {
  return value(form, key) || null;
}

async function context(form: FormData, releaseId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const music = asArtistScopedMusicClient(supabase);
  let requestedArtistId = value(form, "artist_id") || undefined;

  if (!requestedArtistId) {
    const { data: releaseScope, error: scopeError } = await music
      .from("releases")
      .select("artist_id")
      .eq("id", releaseId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (scopeError) throw new Error(scopeError.message);
    if (!releaseScope) throw new Error("Release not found for this owner.");
    requestedArtistId = releaseScope.artist_id;
  }

  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  return {
    supabase,
    user,
    artist,
    music,
    marketing: asMarketingClient(supabase),
  };
}

async function releaseForArtist(
  scoped: Awaited<ReturnType<typeof context>>,
  releaseId: string,
) {
  const { data, error } = await scoped.music
    .from("releases")
    .select("*")
    .eq("id", releaseId)
    .eq("owner_id", scoped.user.id)
    .eq("artist_id", scoped.artist.artistId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Release not found for the active artist.");
  return data;
}

export async function saveWorkspaceTrack(form: FormData) {
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const scoped = await context(form, releaseId);
  await releaseForArtist(scoped, releaseId);
  const isPrimary = form.get("is_primary") === "on";

  if (isPrimary) {
    const { error: clearError } = await scoped.music
      .from("tracks")
      .update({ is_primary: false })
      .eq("owner_id", scoped.user.id)
      .eq("artist_id", scoped.artist.artistId)
      .eq("release_id", releaseId);
    if (clearError) throw new Error(clearError.message);
  }

  const { error } = await scoped.music.from("tracks").insert({
    owner_id: scoped.user.id,
    artist_id: scoped.artist.artistId,
    release_id: releaseId,
    title: required.parse(value(form, "title")),
    version: nullable(form, "version"),
    duration: value(form, "duration") ? nonnegative.parse(value(form, "duration")) : null,
    audio_url: nullable(form, "audio_url"),
    soundcloud_url: nullable(form, "soundcloud_url"),
    spotify_url: nullable(form, "spotify_url"),
    is_primary: isPrimary,
    notes: nullable(form, "notes"),
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/releases");
}

export async function deleteWorkspaceTrack(form: FormData) {
  const trackId = z.uuid().parse(value(form, "id"));
  const releaseId = z.uuid().parse(value(form, "release_id"));
  const scoped = await context(form, releaseId);
  await releaseForArtist(scoped, releaseId);

  const { error } = await scoped.music
    .from("tracks")
    .delete()
    .eq("id", trackId)
    .eq("release_id", releaseId)
    .eq("owner_id", scoped.user.id)
    .eq("artist_id", scoped.artist.artistId);
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath("/studio/releases");
}

export async function generateReleaseIdentity(form: FormData) {
  const releaseId = z.uuid().parse(value(form, "id"));
  const scoped = await context(form, releaseId);
  const release = await releaseForArtist(scoped, releaseId);
  const generator = new TemplateContentGenerationProvider();
  const releaseIdentity = await generator.generateReleaseIdentity(release);
  const storyAnswers = {
    emotional_moment: value(form, "emotional_moment"),
    musical_distinction: value(form, "musical_distinction"),
    visual_world: value(form, "visual_world"),
    likely_listener: value(form, "likely_listener"),
    listener_feeling: value(form, "listener_feeling"),
    ai_narrative: value(form, "ai_narrative"),
    exclusions: value(form, "exclusions"),
  };

  const { error } = await scoped.music
    .from("releases")
    .update({ story_answers: storyAnswers, release_identity: releaseIdentity })
    .eq("id", releaseId)
    .eq("owner_id", scoped.user.id)
    .eq("artist_id", scoped.artist.artistId);
  if (error) throw new Error(error.message);

  revalidatePath(`/studio/releases/${releaseId}`);
}

export async function generateReleaseContentPack(form: FormData) {
  const releaseId = z.uuid().parse(value(form, "release_id") || value(form, "id"));
  const scoped = await context(form, releaseId);
  const release = await releaseForArtist(scoped, releaseId);
  const items = await new TemplateContentGenerationProvider().generateContentPack(release);

  const { data: campaign, error: campaignError } = await scoped.marketing
    .from("campaigns")
    .select("id")
    .eq("owner_id", scoped.user.id)
    .eq("artist_id", scoped.artist.artistId)
    .eq("release_id", releaseId)
    .not("status", "eq", "archived")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (campaignError) throw new Error(campaignError.message);

  const { error: insertError } = await scoped.marketing.from("content_items").insert(
    items.map((item) => ({
      ...item,
      owner_id: scoped.user.id,
      artist_id: scoped.artist.artistId,
      release_id: releaseId,
      campaign_id: campaign?.id ?? null,
    })),
  );
  if (insertError) throw new Error(insertError.message);

  revalidatePath("/studio/content");
  revalidatePath("/studio/production");
  revalidatePath("/studio/campaigns");
  revalidatePath(`/studio/releases/${releaseId}`);
  redirect(`/studio/content?release=${releaseId}&generated=1&artist=${scoped.artist.artistId}`);
}

export async function deleteWorkspaceRelease(form: FormData) {
  const releaseId = z.uuid().parse(value(form, "id"));
  const scoped = await context(form, releaseId);
  await releaseForArtist(scoped, releaseId);

  const { error } = await scoped.music
    .from("releases")
    .delete()
    .eq("id", releaseId)
    .eq("owner_id", scoped.user.id)
    .eq("artist_id", scoped.artist.artistId);
  if (error) throw new Error(error.message);

  revalidatePath("/studio/releases");
  revalidatePath("/studio");
  redirect(`/studio/releases?artist=${scoped.artist.artistId}`);
}