"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import type { DistributionDatabase } from "@/types/distribution-database";

const EDITABLE_STATES = new Set(["draft", "needs_attention", "ready", "rejected", "error"]);

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

  const [releaseResult, configResult, existingResult] = await Promise.all([
    db.from("releases").select("id,artist_id").eq("id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("release_distribution_configs").select("state").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_release_metadata").select("*").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
  ]);
  for (const result of [releaseResult, configResult, existingResult]) if (result.error) throw new Error(result.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  if (configResult.data && !EDITABLE_STATES.has(configResult.data.state)) {
    throw new Error("Distribution identity is locked after submission. Start a correction workflow before changing delivered metadata.");
  }

  const upcSource = value(form, "upc_source") === "artist" ? "artist" as const : "provider" as const;
  const suppliedUpc = value(form, "upc").replace(/[\s-]/g, "");
  if (upcSource === "artist" && !/^\d{12,14}$/.test(suppliedUpc)) {
    throw new Error("A supplied UPC/EAN must contain 12 to 14 digits.");
  }
  const existing = existingResult.data;
  const preserveProviderUpc = upcSource === "provider" && existing?.upc_source === "provider" && existing.upc;
  const upc = upcSource === "artist" ? suppliedUpc : preserveProviderUpc || null;
  const upcStatus = upcSource === "artist"
    ? "assigned" as const
    : upc
      ? existing?.upc_status ?? "assigned"
      : "unassigned" as const;

  const originalReleaseDate = dateOrNull(value(form, "original_release_date"));
  const preorderDate = dateOrNull(value(form, "preorder_date"));
  if (preorderDate && originalReleaseDate && preorderDate > originalReleaseDate) {
    throw new Error("Pre-order date cannot be after the original release date.");
  }

  const save = await db.from("distribution_release_metadata").upsert({
    release_id: releaseId,
    owner_id: user.id,
    artist_id: artist.artistId,
    metadata_language_code: value(form, "metadata_language_code") || "en",
    label_name: value(form, "label_name"),
    catalog_number: value(form, "catalog_number") || null,
    product_copyright_line: value(form, "product_copyright_line"),
    recording_copyright_line: value(form, "recording_copyright_line"),
    upc_source: upcSource,
    upc_status: upcStatus,
    upc,
    original_release_date: originalReleaseDate,
    preorder_date: preorderDate,
  }, { onConflict: "release_id" });
  if (save.error) throw new Error(save.error.message);

  revalidatePath("/studio/distribution");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
  revalidatePath("/studio/needs-you");
  revalidatePath("/studio");
}
