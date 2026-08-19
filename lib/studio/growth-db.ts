import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { GrowthDatabase } from "@/types/growth-database";

export function asGrowthClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<GrowthDatabase>;
}
