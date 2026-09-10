import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import type { AutonomyContractsDatabase } from "@/types/autonomy-contracts-database";

export function asAutonomyContractsClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<AutonomyContractsDatabase>;
}

export function createAutonomyContractsServiceClient() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for autonomy decision auditing.");
  return createClient<AutonomyContractsDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
