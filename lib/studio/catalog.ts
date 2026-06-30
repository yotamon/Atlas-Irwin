import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  const { error } = await supabase.from("homepage_placements").upsert(
    {
      owner_id: ownerId,
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
  const { error } = await supabase.from("releases").update(values).eq("id", releaseId);
  if (error) throw new Error(error.message);
}
