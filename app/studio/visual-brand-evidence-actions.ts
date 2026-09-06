"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { requireArtistContext } from "@/lib/studio/artist-context";
import { mediaMetadata } from "@/lib/studio/media";
import type { Json } from "@/types/database";

const relationshipSchema = z.enum(["official", "inspiration", "experimental", "avoid"]);
const RELATIONSHIP_TAGS = ["brand:official", "brand:inspiration", "brand:experimental", "brand:avoid"];

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function record(value: Json | unknown): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

export async function setVisualBrandEvidenceRelationship(form: FormData) {
  const assetId = z.string().uuid().parse(value(form, "asset_id"));
  const relationship = relationshipSchema.parse(value(form, "relationship"));
  const artist = await requireArtistContext(value(form, "artist_id") || undefined);
  const { supabase, user } = await requireStudioAdmin();
  const { data: asset, error } = await supabase
    .from("media_assets")
    .select("id,owner_id,asset_type,metadata,storage_path")
    .eq("id", assetId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!asset) throw new Error("Visual reference was not found in this workspace.");

  const metadata = mediaMetadata(asset);
  const artistTag = `artist:${artist.artistId}`.toLowerCase();
  if (!metadata.tags.map((tag) => tag.toLowerCase()).includes(artistTag)) {
    throw new Error("Visual reference does not belong to the active artist.");
  }
  const tags = metadata.tags.filter((tag) => !RELATIONSHIP_TAGS.includes(tag.toLowerCase()));
  tags.push(`brand:${relationship}`);
  const nextMetadata = {
    ...record(asset.metadata),
    tags: Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))),
  } as Json;
  const nextAssetType = asset.asset_type === "brand_logo"
    ? "brand_logo"
    : relationship === "avoid"
      ? "brand_negative_reference"
      : "brand_reference";
  const { error: updateError } = await supabase
    .from("media_assets")
    .update({ metadata: nextMetadata, asset_type: nextAssetType })
    .eq("id", assetId)
    .eq("owner_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath("/studio/settings/brand/visual");
  revalidatePath("/studio/brand");
}
