import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import { getSupabaseEnv } from "./config";

function getServiceRoleKey() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for server operations.");
  }
  return serviceRoleKey;
}

export function createServiceClient() {
  const { url } = getSupabaseEnv();
  return createClient<VideoDatabase>(url, getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createCatalogClient() {
  const { url } = getSupabaseEnv();
  return createClient<Database>(url, getServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getPublicCatalogOwnerId() {
  return process.env.PUBLIC_CATALOG_OWNER_ID?.trim() || null;
}
