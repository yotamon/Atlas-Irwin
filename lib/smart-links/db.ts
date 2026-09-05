import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import type { SmartLinksDatabase } from "@/types/smart-links-database";

export function asSmartLinksClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<SmartLinksDatabase>;
}

export function createSmartLinksServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Smart Link public events.");
  return createClient<SmartLinksDatabase>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
