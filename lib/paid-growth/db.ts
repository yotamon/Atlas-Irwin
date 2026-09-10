import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import type { PaidGrowthDatabase } from "@/types/paid-growth-database";

export function asPaidGrowthClient(db: SupabaseClient<Database>) {
  return db as unknown as SupabaseClient<PaidGrowthDatabase>;
}

export function createPaidGrowthServiceClient() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Paid Growth provider operations.");
  return createClient<PaidGrowthDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
