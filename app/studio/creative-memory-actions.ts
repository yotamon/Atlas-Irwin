"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { setCreativeAssetExcluded, upsertCreativeAssetProfile } from "@/lib/creative-memory/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { mediaMetadata } from "@/lib/studio/media";
import type { CreativeMemoryDatabase } from "@/types/creative-memory-database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function creativeAssetContext(assetId: string) {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const music = asArtistScopedMusicClient(supabase);
  const memory = supabase as unknown as SupabaseClient<CreativeMemoryDatabase>;
  const [{ data: asset, error: assetError }, linksResult, profileResult, eventResult] = await Promise.all([
    supabase.from("media_assets").select("*").eq("id", assetId).eq("owner_id", user.id).maybeSingle(),
    music.from("media_links").select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("media_asset_id", assetId)
      .limit(1),
    memory.from("creative_asset_profiles").select("asset_id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("asset_id", assetId)
      .maybeSingle(),
    memory.from("creative_memory_events").select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("asset_id", assetId)
      .limit(1),
  ]);
  if (assetError || !asset) throw new Error(assetError?.message ?? "Creative asset not found.");
  const firstError = [linksResult.error, profileResult.error, eventResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);
  const artistTag = `artist:${artist.artistId}`.toLowerCase();
  const tagged = mediaMetadata(asset).tags.some((tag) => tag.toLowerCase() === artistTag);
  const remembered = Boolean(profileResult.data || (eventResult.data ?? []).length);
  if (!tagged && !(linksResult.data ?? []).length && !remembered) {
    throw new Error("This asset does not belong to the active artist's Creative Memory.");
  }
  return { supabase, user, artist, asset };
}

export async function setCreativeMemoryAssetExclusion(form: FormData) {
  const assetId = z.uuid().parse(value(form, "asset_id"));
  const excluded = z.enum(["true", "false"]).parse(value(form, "excluded")) === "true";
  const reason = z.string().trim().max(1000).parse(value(form, "reason"));
  const { supabase, user, artist } = await creativeAssetContext(assetId);
  await setCreativeAssetExcluded({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
    assetId,
    excluded,
    reason: reason || null,
  });
  revalidatePath("/studio/library");
}

export async function updateCreativeMemoryAssetProfile(form: FormData) {
  const assetId = z.uuid().parse(value(form, "asset_id"));
  const relevance = z.coerce.number().min(0).max(1).parse(value(form, "brand_relevance"));
  const visual = value(form, "visual_descriptors").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
  const semantic = value(form, "semantic_descriptors").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
  const { supabase, user, artist } = await creativeAssetContext(assetId);
  await upsertCreativeAssetProfile({
    db: supabase,
    ownerId: user.id,
    artistId: artist.artistId,
    assetId,
    brandRelevance: relevance,
    visualDescriptors: visual,
    semanticDescriptors: semantic,
    reviewed: true,
  });
  revalidatePath("/studio/library");
}
