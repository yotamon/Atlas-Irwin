import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ArtistScopedGrowthDatabase } from "@/types/artist-scoped-operational-database";

export function asGrowthClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<ArtistScopedGrowthDatabase>;
}
