"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { updateModeFromProviderMetadata } from "@/lib/distribution/update-safety";
import { submitDistribution as submitInitialDistribution } from "./distribution-runtime-actions";
import { submitDistributionUpdate } from "./distribution-update-action";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

export async function submitDistribution(form: FormData) {
  const releaseId = String(form.get("release_id") ?? "").trim();
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as Db;
  const config = await db.from("release_distribution_configs").select("provider_metadata").eq("release_id", releaseId).eq("owner_id", user.id).maybeSingle();
  if (config.error) throw new Error(config.error.message);
  if (updateModeFromProviderMetadata(config.data?.provider_metadata).active) {
    return submitDistributionUpdate(form);
  }
  return submitInitialDistribution(form);
}
