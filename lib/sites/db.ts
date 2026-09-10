import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { EnsemblisSitesDatabase } from "@/types/ensemblis-sites";

export function asSitesClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<EnsemblisSitesDatabase>;
}
