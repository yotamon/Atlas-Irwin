import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ArtistScopedSocialDatabase } from "@/types/artist-scoped-operational-database";

export function asSocialClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<ArtistScopedSocialDatabase>;
}
