import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { AutonomyDatabase } from "@/types/autonomy-database";

export function createAutonomyServiceClient() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for marketing autonomy.");
  return createClient<AutonomyDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
