"use server";

import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asStemClient } from "@/lib/music-intelligence/stem-scenes";
import * as actions from "./stem-actions";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function assertActiveArtistStemTarget(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const stems = asStemClient(supabase);

  const suppliedTrackId = formValue(form, "track_id");
  const stemId = formValue(form, "stem_id");
  const sceneId = formValue(form, "scene_id");
  let derivedTrackId: string | null = null;

  if (stemId) {
    const { data: stem, error } = await stems
      .from("track_stems")
      .select("id,track_id,artist_id")
      .eq("id", stemId)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!stem) throw new Error("Stem not found for the active artist.");
    derivedTrackId = stem.track_id;
  }

  if (sceneId) {
    const { data: scene, error } = await stems
      .from("audio_scenes")
      .select("id,track_id,artist_id")
      .eq("id", sceneId)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!scene) throw new Error("Audio Scene not found for the active artist.");
    if (derivedTrackId && derivedTrackId !== scene.track_id) {
      throw new Error("Stem and Audio Scene do not belong to the same track.");
    }
    derivedTrackId = scene.track_id;
  }

  if (suppliedTrackId && derivedTrackId && suppliedTrackId !== derivedTrackId) {
    throw new Error("Stem Intelligence target does not match the supplied track.");
  }

  const trackId = suppliedTrackId || derivedTrackId;
  if (!trackId) throw new Error("Stem Intelligence requires a track target.");

  const { data: track, error: trackError } = await music
    .from("tracks")
    .select("id,release_id,artist_id")
    .eq("id", trackId)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (trackError) throw new Error(trackError.message);
  if (!track) throw new Error("Track not found for the active artist.");

  return { user, artist, track };
}

async function guarded<T>(form: FormData, action: (form: FormData) => Promise<T>) {
  await assertActiveArtistStemTarget(form);
  return action(form);
}

export async function registerTrackStem(form: FormData) {
  return guarded(form, actions.registerTrackStem);
}

export async function retryStemAnalysis(form: FormData) {
  return guarded(form, actions.retryStemAnalysis);
}

export async function updateStemIdentity(form: FormData) {
  return guarded(form, actions.updateStemIdentity);
}

export async function removeTrackStem(form: FormData) {
  return guarded(form, actions.removeTrackStem);
}

export async function regenerateAudioScenes(form: FormData) {
  return guarded(form, actions.regenerateAudioScenes);
}

export async function renderAudioScenePreview(form: FormData) {
  return guarded(form, actions.renderAudioScenePreview);
}

export async function toggleAudioScenePin(form: FormData) {
  return guarded(form, actions.toggleAudioScenePin);
}

export async function saveCustomAudioScene(form: FormData) {
  return guarded(form, actions.saveCustomAudioScene);
}
