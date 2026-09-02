import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asArtistScopedMusicClient } from "./music-db";
import type { Database } from "@/types/database";

export function revalidatePublicCatalog() {
  revalidateTag("public-catalog", "default");
  revalidatePath("/");
}

export async function upsertHomepagePlacement(
  supabase: SupabaseClient<Database>,
  ownerId: string,
  releaseId: string,
  values: {
    enabled: boolean;
    display_order: number;
    default_track_id?: string | null;
    placement_type?: string;
  },
) {
  const db = asArtistScopedMusicClient(supabase);
  const { data: release, error: releaseError } = await db
    .from("releases")
    .select("id,owner_id,artist_id")
    .eq("id", releaseId)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release || release.owner_id !== ownerId) {
    throw new Error("Release not found for this catalog owner.");
  }

  if (values.default_track_id) {
    const { data: track, error: trackError } = await db
      .from("tracks")
      .select("id,release_id,artist_id")
      .eq("id", values.default_track_id)
      .eq("release_id", releaseId)
      .eq("artist_id", release.artist_id)
      .maybeSingle();
    if (trackError) throw new Error(trackError.message);
    if (!track) throw new Error("Homepage default track must belong to the release artist.");
  }

  const { error } = await db.from("homepage_placements").upsert(
    {
      owner_id: ownerId,
      artist_id: release.artist_id,
      release_id: releaseId,
      enabled: values.enabled,
      display_order: values.display_order,
      default_track_id: values.default_track_id ?? null,
      placement_type: values.placement_type ?? "catalog",
    },
    { onConflict: "owner_id,release_id" },
  );
  if (error) throw new Error(error.message);
}

export async function setReleasePublishState(
  supabase: SupabaseClient<Database>,
  releaseId: string,
  values: {
    publish_state: string;
    is_public: boolean;
    published_at?: string | null;
    status?: string;
  },
) {
  const db = asArtistScopedMusicClient(supabase);
  const { data: release, error: releaseError } = await db
    .from("releases")
    .select("id,artist_id")
    .eq("id", releaseId)
    .maybeSingle();
  if (releaseError) throw new Error(releaseError.message);
  if (!release) throw new Error("Release not found.");

  const { error } = await db
    .from("releases")
    .update(values)
    .eq("id", releaseId)
    .eq("artist_id", release.artist_id);
  if (error) throw new Error(error.message);
}
