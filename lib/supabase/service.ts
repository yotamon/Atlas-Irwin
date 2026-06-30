import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabaseEnv } from "./config";

export function createServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for server catalog operations.",
    );
  }
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createCatalogClient() {
  const { url, key } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return createClient<Database>(url, serviceRoleKey || key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getPublicCatalogOwnerId() {
  const ownerId = process.env.PUBLIC_CATALOG_OWNER_ID?.trim();
  if (ownerId) return ownerId;
  return null;
}
