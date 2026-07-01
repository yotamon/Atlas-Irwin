import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !serviceKey) throw new Error("Supabase service credentials are required.");

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: assets, error: assetError } = await supabase
  .from("media_assets")
  .select("*")
  .or("visibility.neq.public,bucket_name.neq.public-media,public_url.is.null");
if (assetError) throw assetError;

let migrated = 0;
for (const asset of assets ?? []) {
  const { data: file, error: downloadError } = await supabase.storage
    .from(asset.bucket_name)
    .download(asset.storage_path);
  if (downloadError || !file) throw downloadError || new Error(`Could not download ${asset.storage_path}`);

  const targetPath = asset.storage_path;
  const { error: uploadError } = await supabase.storage
    .from("public-media")
    .upload(targetPath, file, { contentType: asset.mime_type || file.type, upsert: true });
  if (uploadError) throw uploadError;

  const publicUrl = supabase.storage.from("public-media").getPublicUrl(targetPath).data.publicUrl;
  const { error: updateError } = await supabase
    .from("media_assets")
    .update({ bucket_name: "public-media", visibility: "public", public_url: publicUrl })
    .eq("id", asset.id);
  if (updateError) throw updateError;

  if (asset.bucket_name !== "public-media") {
    const { error: removeError } = await supabase.storage.from(asset.bucket_name).remove([asset.storage_path]);
    if (removeError) console.warn(`Migrated ${asset.id}, but could not remove its old private object: ${removeError.message}`);
  }
  migrated += 1;
}

const { data: coverLinks, error: linkError } = await supabase
  .from("media_links")
  .select("release_id,media_asset_id,is_primary")
  .eq("role", "cover")
  .not("release_id", "is", null)
  .order("is_primary", { ascending: false });
if (linkError) throw linkError;

for (const releaseId of new Set((coverLinks ?? []).map((link) => link.release_id))) {
  const links = (coverLinks ?? []).filter((link) => link.release_id === releaseId);
  const assetIds = links.map((link) => link.media_asset_id);
  const { data: covers, error } = await supabase.from("media_assets").select("id,public_url").in("id", assetIds);
  if (error) throw error;
  const artworkUrl = links.map((link) => covers?.find((cover) => cover.id === link.media_asset_id)?.public_url).find(Boolean);
  if (artworkUrl) await supabase.from("releases").update({ artwork_url: artworkUrl }).eq("id", releaseId);
}

console.log(`Migrated ${migrated} media asset${migrated === 1 ? "" : "s"} to public storage.`);
