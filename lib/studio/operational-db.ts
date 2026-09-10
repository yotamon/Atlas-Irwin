import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ArtistScopedCoreOperationalDatabase } from "@/types/artist-scoped-operational-database";

export function asArtistScopedOperationalClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<ArtistScopedCoreOperationalDatabase>;
}
