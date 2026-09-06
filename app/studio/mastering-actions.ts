"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMasteringClient, kickMasteringQueue, masteringOutputPath } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import type { Json } from "@/types/database";
import type { MasteringPreset, TrackMasteringJob } from "@/types/mastering-database";

const presetSchema = z.enum(["balanced", "punchy", "dynamic"]);

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

function signature(value: Json) {
  const inspector = record(record(value).mastering_inspector);
  const result = record(inspector.reference_signature);
  return Object.keys(result).length ? result : null;
}

export async function createActiveMaster(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const growth = asGrowthClient(supabase);
  const mastering = asMasteringClient(supabase);
  const trackId = z.uuid().parse(String(form.get("track_id") ?? ""));
  const preset = presetSchema.parse(String(form.get("preset") ?? "balanced")) as MasteringPreset;

  const [trackResult, catalogResult, activeResult] = await Promise.all([
    growth.from("track_vault")
      .select("id,title,audio_url,media_asset_id,audio_profile")
      .eq("id", trackId)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .single(),
    growth.from("track_vault")
      .select("id,audio_profile")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .neq("id", trackId)
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
  if (catalogResult.error) throw new Error(catalogResult.error.message);
  if (activeResult.error) throw new Error(activeResult.error.message);
  if (activeResult.data) return { jobId: activeResult.data.id, deduplicated: true };

  const track = trackResult.data;
  if (!track.audio_url) throw new Error("Add a canonical master before using Active Mastering.");
  const inspector = record(record(track.audio_profile).mastering_inspector);
  if (!Object.keys(inspector).length) {
    throw new Error("Run Track Intelligence first so Active Mastering has deterministic mastering evidence.");
  }

  const references = (catalogResult.data ?? [])
    .map((item) => signature(item.audio_profile))
    .filter((item): item is Record<string, unknown> => Boolean(item));
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
