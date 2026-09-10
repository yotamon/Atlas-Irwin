"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { analyzeVaultTrack } from "@/app/studio/growth-media-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Json } from "@/types/database";

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown) {
  return value as Json;
}

export async function connectCatalogTrackToIntelligence(form: FormData): Promise<void> {
  const trackId = z.uuid().parse(formValue(form, "track_id"));
  const requestedArtistId = formValue(form, "artist_id") || undefined;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  const music = asArtistScopedMusicClient(supabase);
  const growth = asGrowthClient(supabase);

  const { data: track, error: trackError } = await music
    .from("tracks")
    .select("*")
    .eq("id", trackId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (trackError) throw new Error(trackError.message);
  if (!track) throw new Error("Track not found for the active artist.");
  if (!track.audio_url) throw new Error("This track does not have a master audio source yet.");

  const [releaseResult, existingResult] = await Promise.all([
    music
      .from("releases")
      .select("id,status,publish_state")
      .eq("id", track.release_id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle(),
    growth
      .from("track_vault")
      .select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("linked_track_id", track.id)
      .maybeSingle(),
  ]);
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (!releaseResult.data) throw new Error("The release for this track could not be found.");
  if (existingResult.error) throw new Error(existingResult.error.message);

  if (existingResult.data) {
    redirect(ensemblisArtistHref(`/studio/music/${existingResult.data.id}`, artist.artistId));
  }

  const release = releaseResult.data;
  const vaultStatus = release.publish_state === "live" || release.status === "Live"
    ? "released"
    : release.status === "Scheduled"
      ? "scheduled"
      : "release_candidate";

  const { data: created, error: createError } = await growth
    .from("track_vault")
    .insert({
      owner_id: user.id,
      artist_id: artist.artistId,
      linked_release_id: track.release_id,
      linked_track_id: track.id,
      media_asset_id: null,
      title: track.title,
      version: track.version,
      status: vaultStatus,
      audio_url: track.audio_url,
      duration_seconds: track.duration,
      notes: track.notes,
      source: "backfill",
      release_readiness: 72,
      analysis_confidence: 0,
      audio_profile: json({}),
      analysis: json({
        status: "pending",
        requested_from: "existing_catalog_master",
        music_intelligence_version: 4,
      }),
    })
    .select("id")
    .single();

  let vaultId = created?.id ?? null;
  if (createError || !vaultId) {
    // A second request can race the unique linked-track constraint. Reuse the winner
    // instead of turning a harmless double-click into a broken release workflow.
    const { data: raced, error: raceError } = await growth
      .from("track_vault")
      .select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("linked_track_id", track.id)
      .maybeSingle();
    if (raceError || !raced) {
      throw new Error(createError?.message || raceError?.message || "Could not connect this master to Music Intelligence.");
    }
    vaultId = raced.id;
  }

  const analysisForm = new FormData();
  analysisForm.set("id", vaultId);
  // The canonical master is already safely linked. Analysis is retryable and should
  // never make the user re-upload or lose access to the track if the worker is busy.
  await analyzeVaultTrack(analysisForm).catch(() => undefined);

  revalidatePath("/studio/music");
  revalidatePath(`/studio/music/${track.id}`);
  revalidatePath(`/studio/music/${vaultId}`);
  revalidatePath(`/studio/releases/${track.release_id}`);
  revalidatePath("/studio/releases");
  revalidatePath("/studio");

  redirect(ensemblisArtistHref(`/studio/music/${vaultId}`, artist.artistId));
}
