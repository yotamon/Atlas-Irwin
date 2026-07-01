import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MediaAsset } from "@/types/database";

export async function createMediaPreviewMap(
  supabase: SupabaseClient<Database>,
  assets: MediaAsset[],
) {
  const previews: Record<string, string> = {};
  const privateByBucket = new Map<string, MediaAsset[]>();
  for (const asset of assets) {
    if (asset.public_url) {
      previews[asset.id] = asset.public_url;
      continue;
    }
    privateByBucket.set(asset.bucket_name, [...(privateByBucket.get(asset.bucket_name) ?? []), asset]);
  }
  await Promise.all([...privateByBucket].map(async ([bucket, bucketAssets]) => {
    const paths = bucketAssets.map((asset) => asset.storage_path);
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60);
    for (const signed of data ?? []) {
      const asset = bucketAssets.find((item) => item.storage_path === signed.path);
      if (asset && signed.signedUrl) previews[asset.id] = signed.signedUrl;
    }
  }));
  return previews;
}

