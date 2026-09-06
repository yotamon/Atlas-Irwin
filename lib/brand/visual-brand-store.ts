import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseVisualBrandDna, toVisualBrandPromptContext, type VisualBrandDna, type VisualBrandPromptContext } from "./visual-brand-dna";
import type { VisualBrandDatabase, VisualBrandVersionRow } from "@/types/visual-brand-database";

export type ActiveVisualBrand = {
  id: string;
  version: number;
  dna: VisualBrandDna;
  prompt: VisualBrandPromptContext;
  canonicalAssetIds: string[];
  confidence: number;
};

function visualBrandDb(db: SupabaseClient) {
  return db as unknown as SupabaseClient<VisualBrandDatabase>;
}

export async function loadActiveVisualBrand(input: {
  db: SupabaseClient;
  ownerId: string;
  artistId: string;
}): Promise<ActiveVisualBrand | null> {
  const { data, error } = await visualBrandDb(input.db)
    .from("artist_visual_brand_versions")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as VisualBrandVersionRow;
  const dna = parseVisualBrandDna(row.dna);
  if (!dna) return null;
  return {
    id: row.id,
    version: row.version,
    dna,
    prompt: toVisualBrandPromptContext(dna),
    canonicalAssetIds: row.canonical_asset_ids,
    confidence: row.confidence,
  };
}

export async function loadLatestVisualBrandDraft(input: {
  db: SupabaseClient;
  ownerId: string;
  artistId: string;
}) {
  const { data, error } = await visualBrandDb(input.db)
    .from("artist_visual_brand_versions")
    .select("*")
    .eq("owner_id", input.ownerId)
    .eq("artist_id", input.artistId)
    .eq("status", "draft")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as VisualBrandVersionRow | null;
}
