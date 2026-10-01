"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { analyzeVaultTrack } from "@/app/studio/growth-media-actions";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient, kickMasteringQueue, masteringOutputPath } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { Json } from "@/types/database";
import type { MasteringPreset, TrackMasteringJob } from "@/types/mastering-database";

const presetSchema = z.enum(["streaming_safe", "balanced", "punchy", "dynamic"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function compactMusicMap(value: Json) {
  const map = record(value);
  const analysis = record(map.analysis);
  const confidence = record(analysis.confidence);
  return {
    bpm: map.bpm ?? null,
    beats_ms: Array.isArray(map.beats_ms) ? map.beats_ms : [],
    sections: Array.isArray(map.sections) ? map.sections : [],
    analysis: { confidence: { rhythm: confidence.rhythm ?? null } },
    mastering_inspector: map.mastering_inspector ?? {},
  };
}

export async function createActiveMaster(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const mastering = asMasteringClient(supabase);
  const trackId = z.uuid().parse(String(form.get("track_id") ?? ""));
  const preset = presetSchema.parse(String(form.get("preset") ?? "balanced")) as MasteringPreset;

  const [trackResult, referencesResult, activeResult] = await Promise.all([
    growth.from("track_vault")
      .select("id,title,audio_url,media_asset_id,audio_profile")
      .eq("id", trackId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
    mastering.from("mastering_references")
      .select("reference_signature,track_vault_id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("active", true)
      .eq("status", "ready")
      .limit(24),
    mastering.from("track_mastering_jobs")
      .select("id,status")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("track_vault_id", trackId)
      .in("status", ["planned", "queued", "running"])
      .limit(1)
      .maybeSingle(),
  ]);
  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found.");
  if (referencesResult.error) throw new Error(referencesResult.error.message);
  if (activeResult.error) throw new Error(activeResult.error.message);
  if (activeResult.data) return { jobId: activeResult.data.id, deduplicated: true };

  const track = trackResult.data;
  if (!track.audio_url) throw new Error("Add a canonical master before using Active Mastering.");
  const inspector = record(record(track.audio_profile).mastering_inspector);
  if (!Object.keys(inspector).length) {
    throw new Error("Run Track Intelligence first so Active Mastering has deterministic mastering evidence.");
  }

  const references = (referencesResult.data ?? [])
    .filter((item) => item.track_vault_id !== trackId)
    .map((item) => record(item.reference_signature))
    .filter((item) => Object.keys(item).length > 0);
  const id = randomUUID();
  const draft = {
    id,
    owner_id: user.id,
    artist_id: artist.artistId,
    track_vault_id: track.id,
  } as Pick<TrackMasteringJob, "id" | "owner_id" | "artist_id" | "track_vault_id">;
  const outputPath = masteringOutputPath(draft);
  const requestPayload = {
    audio_url: track.audio_url,
    preset,
    music_map: compactMusicMap(track.audio_profile),
    reference_signatures: references,
    source_audio_url: track.audio_url,
    source_media_asset_id: track.media_asset_id,
  };
  const inserted = await mastering.from("track_mastering_jobs").insert({
    id,
    owner_id: user.id,
    artist_id: artist.artistId,
    track_vault_id: track.id,
    preset,
    status: "planned",
    idempotency_key: randomUUID(),
    source_audio_url: track.audio_url,
    source_media_asset_id: track.media_asset_id,
    output_bucket: "public-media",
    output_path: outputPath,
    request_payload: json(requestPayload),
    result_payload: json({}),
  }).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not queue Active Mastering.");

  await kickMasteringQueue().catch(() => undefined);
  revalidatePath(`/studio/music/${track.id}`);
  return { jobId: id, deduplicated: false };
}

export async function promoteActiveMaster(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const mastering = asMasteringClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const jobId = z.uuid().parse(String(form.get("job_id") ?? ""));

  const jobResult = await mastering.from("track_mastering_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("status", "completed")
    .single();
  if (jobResult.error || !jobResult.data) throw new Error(jobResult.error?.message || "Mastering candidate not found.");
  const job = jobResult.data as TrackMasteringJob;
  const request = record(job.request_payload);
  const result = record(job.result_payload);
  const checks = record(result.final_checks);
  const publicUrl = typeof request.public_url === "string" ? request.public_url : "";
  if (!job.output_asset_id || !publicUrl) throw new Error("This mastering candidate has no registered output asset.");
  if (checks.pass !== true) throw new Error("Only a fully verified mastering candidate can become the canonical master.");

  const trackResult = await growth.from("track_vault")
    .select("id,audio_url,linked_release_id,linked_track_id")
    .eq("id", job.track_vault_id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .single();
  if (trackResult.error || !trackResult.data) throw new Error(trackResult.error?.message || "Track not found.");
  if (trackResult.data.audio_url !== job.source_audio_url) {
    throw new Error("The canonical master changed after this candidate was created. Render a fresh candidate from the current source.");
  }

  const updated = await growth.from("track_vault").update({
    audio_url: publicUrl,
    media_asset_id: job.output_asset_id,
    audio_profile: json({}),
    analysis: json({ status: "pending", requested_from: "active_mastering_promotion" }),
    updated_at: new Date().toISOString(),
  }).eq("id", job.track_vault_id).eq("owner_id", user.id).eq("artist_id", artist.artistId);
  if (updated.error) throw new Error(updated.error.message);

  if (trackResult.data.linked_release_id) {
    let canonicalTrackId = trackResult.data.linked_track_id;
    if (!canonicalTrackId) {
      const releaseTracks = await music.from("tracks")
        .select("id")
        .eq("release_id", trackResult.data.linked_release_id)
        .eq("owner_id", user.id)
        .eq("artist_id", artist.artistId)
        .limit(2);
      if (releaseTracks.error) throw new Error(releaseTracks.error.message);
      if ((releaseTracks.data ?? []).length === 1) canonicalTrackId = releaseTracks.data![0].id;
      else throw new Error("This vault track has no exact catalog-track lineage. Link the exact track before promoting a master.");
    }

    const releaseUpdate = await music.from("tracks").update({ audio_url: publicUrl })
      .eq("id", canonicalTrackId)
      .eq("release_id", trackResult.data.linked_release_id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId);
    if (releaseUpdate.error) throw new Error(releaseUpdate.error.message);
  }

  const analysisForm = new FormData();
  analysisForm.set("id", job.track_vault_id);
  await analyzeVaultTrack(analysisForm);
  revalidatePath(`/studio/music/${job.track_vault_id}`);
  if (trackResult.data.linked_release_id) revalidatePath(`/studio/releases/${trackResult.data.linked_release_id}`);
  return { promoted: true, trackId: job.track_vault_id };
}
