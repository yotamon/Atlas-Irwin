import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { FanGraphDatabase } from "@/types/fan-graph-database";

export function asFanGraphClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<FanGraphDatabase>;
}
