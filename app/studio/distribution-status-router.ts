"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { getProviderCatalogIdentity } from "@/lib/distribution/provider-catalog-identity";
import { syncDistributionStatus as syncRuntimeDistributionStatus } from "./distribution-runtime-actions";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function json(value: unknown): Json {
  return value as Json;
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function syncDistributionStatus(form: FormData) {
  const releaseId = text(form, "release_id");
  await syncRuntimeDistributionStatus(form);

  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const [releaseResult, configResult, accountResult, tracksResult, metadataResult] = await Promise.all([
    db.from("releases").select("id,upc").eq("id", releaseId).eq("owner_id", user.id).single(),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).single(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").single(),
    db.from("tracks").select("id,title").eq("release_id", releaseId).eq("owner_id", user.id).order("display_order"),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id),
  ]);
  for (const result of [releaseResult, configResult, accountResult, tracksResult, metadataResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const config = configResult.data;
  if (!config.provider_release_id) return;

  const identity = await getProviderCatalogIdentity(accountResult.data, config.provider_release_id);
  const tracks = tracksResult.data ?? [];
  if (identity.tracks.length && identity.tracks.length !== tracks.length) {
    throw new Error("Provider catalog track count no longer matches Ensemblis. Automatic identifier reconciliation was blocked.");
  }

  const localUpc = normalized(releaseResult.data.upc);
  const providerUpc = normalized(identity.upc);
  if (localUpc && providerUpc && localUpc !== providerUpc) {
    throw new Error(`Provider UPC ${identity.upc} conflicts with Ensemblis UPC ${releaseResult.data.upc}. Reconcile the catalog before further distribution changes.`);
  }
  if (!localUpc && identity.upc) {
    const upcWrite = await db.from("releases").update({ upc: identity.upc }).eq("id", releaseId).eq("owner_id", user.id);
    if (upcWrite.error) throw new Error(upcWrite.error.message);
  }

  const metadata = (metadataResult.data ?? []).filter((row) => tracks.some((track) => track.id === row.track_id));
  const metadataByTrack = new Map(metadata.map((row) => [row.track_id, row]));
  const assignedTracks: Array<Record<string, unknown>> = [];
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    const providerTrack = identity.tracks[index];
    if (!providerTrack) continue;
    const row = metadataByTrack.get(track.id);
    const localIsrc = normalized(row?.isrc);
    const providerIsrc = normalized(providerTrack.isrc);
    if (localIsrc && providerIsrc && localIsrc !== providerIsrc) {
      throw new Error(`Provider ISRC ${providerTrack.isrc} conflicts with Ensemblis ISRC ${row?.isrc} for '${track.title}'. Reconcile the track identity before further distribution changes.`);
    }
    if (row && !localIsrc && providerTrack.isrc) {
      const isrcWrite = await db.from("distribution_track_metadata").update({ isrc: providerTrack.isrc }).eq("track_id", track.id).eq("owner_id", user.id);
      if (isrcWrite.error) throw new Error(isrcWrite.error.message);
    }
    assignedTracks.push({
      trackId: track.id,
      providerTrackId: providerTrack.providerTrackId,
      isrc: providerTrack.isrc,
      audioId: providerTrack.audioId,
      audioFilename: providerTrack.audioFilename,
      fileFormat: providerTrack.fileFormat,
    });
  }

  const syncedAt = new Date().toISOString();
  const providerMetadata = {
    ...object(config.provider_metadata),
    assignedIdentity: {
      syncedAt,
      providerReleaseId: identity.providerReleaseId,
      upc: identity.upc,
      tracks: assignedTracks,
    },
  };
  const configWrite = await db.from("release_distribution_configs").update({ provider_metadata: json(providerMetadata) }).eq("release_id", releaseId).eq("owner_id", user.id);
  if (configWrite.error) throw new Error(configWrite.error.message);
  const event = await db.from("distribution_events").insert({
    owner_id: user.id,
    release_id: releaseId,
    submission_id: null,
    event_type: "distribution.provider_identity_synced",
    actor_type: "provider",
    provider: config.provider,
    payload: json({ upc: identity.upc, tracks: assignedTracks }),
  });
  if (event.error) throw new Error(event.error.message);

  revalidatePath("/studio/distribution");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}
