"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { analyzeTrackLyrics } from "@/lib/lyrics-intelligence/analyze";
import { parseLyrics } from "@/lib/lyrics-intelligence/domain";
import type { Json } from "@/types/database";
import type { LyricsDatabase, LyricsStatus } from "@/types/lyrics-database";

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function checked(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

async function studioLyricsContext(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as SupabaseClient<LyricsDatabase>;
  const trackId = text(form, "track_id");
  const releaseId = text(form, "release_id");
  if (!trackId || !releaseId) throw new Error("Track and release are required for Lyrics Intelligence.");

  const { data: track, error } = await db.from("tracks")
    .select("id,release_id,title")
    .eq("id", trackId)
    .eq("release_id", releaseId)
    .eq("owner_id", user.id)
    .single();
  if (error || !track) throw new Error(error?.message || "Track not found.");
  return { db, user, trackId, releaseId };
}

async function persistLyrics(form: FormData, status: LyricsStatus = "verified") {
  const context = await studioLyricsContext(form);
  const canonicalText = status === "instrumental" ? "" : text(form, "canonical_text");
  if (status !== "instrumental" && !canonicalText) throw new Error("Paste the official lyrics before saving.");
  const sections = status === "instrumental" ? [] : parseLyrics(canonicalText);
  if (status !== "instrumental" && !sections.length) throw new Error("Atlas could not find any lyric lines to save.");

  const { data: lyricsId, error } = await context.db.rpc("save_track_lyrics", {
    p_track_id: context.trackId,
    p_canonical_text: canonicalText,
    p_language: text(form, "language") || null,
    p_status: status,
    p_allow_ai_context: status === "instrumental" ? false : checked(form, "allow_ai_context"),
    p_allow_media_quotes: status === "instrumental" ? false : checked(form, "allow_media_quotes"),
    p_sections: sections as unknown as Json,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/releases/${context.releaseId}`);
  return { ...context, lyricsId };
}

export async function saveTrackLyricsAction(form: FormData) {
  await persistLyrics(form);
}

export async function saveAndAnalyzeTrackLyricsAction(form: FormData) {
  const context = await persistLyrics(form);
  await analyzeTrackLyrics({
    db: context.db,
    ownerId: context.user.id,
    trackId: context.trackId,
    releaseId: context.releaseId,
    cacheMode: "use",
  });
  revalidatePath(`/studio/releases/${context.releaseId}`);
  revalidatePath("/studio/production");
  revalidatePath("/studio/video");
}

export async function analyzeTrackLyricsAction(form: FormData) {
  const context = await studioLyricsContext(form);
  await analyzeTrackLyrics({
    db: context.db,
    ownerId: context.user.id,
    trackId: context.trackId,
    releaseId: context.releaseId,
    cacheMode: "refresh",
  });
  revalidatePath(`/studio/releases/${context.releaseId}`);
  revalidatePath("/studio/production");
  revalidatePath("/studio/video");
}

export async function markTrackInstrumentalAction(form: FormData) {
  await persistLyrics(form, "instrumental");
}