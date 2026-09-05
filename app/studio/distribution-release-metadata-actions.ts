"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { DistributionDatabase } from "@/types/distribution-database";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function dateOrNull(raw: string) {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Dates must use YYYY-MM-DD.");
  return raw;
}

export async function saveDistributionReleaseMetadata(form: FormData) {
  const releaseId = value(form, "release_id");
  if (!releaseId) throw new Error("Release is required.");

  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = value(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as SupabaseClient<DistributionDatabase>;

  const { data: release, error: releaseError } = await db.from("releases")
    .select("id")
    .eq("id", releaseId)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) throw new Error("Release not found for the active artist.");

  const upcSource = value(form, "upc_source") === "artist" ? "artist" : "provider";
  const suppliedUpc = value(form, "upc").replace(/[\s-]/g, "");
  if (upcSource === "artist" && !/^\d{12,14}$/.test(suppliedUpc)) {
    throw new Error("A supplied UPC/EAN must contain 12 to 14 digits.");
  }
  const originalReleaseDate = dateOrNull(value(form, "original_release_date"));
  const preorderDate = dateOrNull(value(form, "preorder_date"));
  if (preorderDate && originalReleaseDate && preorderDate > originalReleaseDate) {
    throw new Error("Pre-order date cannot be after the original release date.");
  }

  const { error } = await db.rpc("save_distribution_release_identity", {
    p_release_id: releaseId,
    p_label: value(form, "label_name"),
    p_upc_source: upcSource,
    p_upc: suppliedUpc || null,
    p_metadata_language_code: value(form, "metadata_language_code") || "en",
    p_catalog_number: value(form, "catalog_number") || null,
    p_product_copyright_line: value(form, "product_copyright_line"),
    p_recording_copyright_line: value(form, "recording_copyright_line"),
    p_original_release_date: originalReleaseDate,
    p_preorder_date: preorderDate,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/studio/distribution");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
  revalidatePath("/studio/needs-you");
  revalidatePath("/studio");
}
