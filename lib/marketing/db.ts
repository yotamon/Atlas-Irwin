import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import type { ArtistScopedMarketingDatabase } from "@/types/artist-scoped-operational-database";

export function asMarketingClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<ArtistScopedMarketingDatabase>;
}

export function createMarketingServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Marketing Engine service operations.");
  }
  return createClient<ArtistScopedMarketingDatabase>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
