import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type MediaDeliverySource = {
  publicUrl: string | null | undefined;
  bucketName: string | null | undefined;
  storagePath: string | null | undefined;
};

export async function resolveMediaDeliveryUrl(
  client: SupabaseClient<Database>,
  source: MediaDeliverySource,
  expiresInSeconds = 60 * 60,
) {
  const publicUrl = source.publicUrl?.trim();
  if (publicUrl) return publicUrl;

  const bucketName = source.bucketName?.trim();
  const storagePath = source.storagePath?.trim();
  if (!bucketName || !storagePath) return null;

  const { data, error } = await client.storage
    .from(bucketName)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export function releaseCoverDeliverySource(release: {
  cover_public_url?: string | null;
  cover_bucket_name?: string | null;
  cover_storage_path?: string | null;
}): MediaDeliverySource {
  return {
    publicUrl: release.cover_public_url,
    bucketName: release.cover_bucket_name,
    storagePath: release.cover_storage_path,
  };
}

export function trackMasterDeliverySource(track: {
  master_audio_public_url?: string | null;
  master_audio_bucket_name?: string | null;
  master_audio_storage_path?: string | null;
}): MediaDeliverySource {
  return {
    publicUrl: track.master_audio_public_url,
    bucketName: track.master_audio_bucket_name,
    storagePath: track.master_audio_storage_path,
  };
}
