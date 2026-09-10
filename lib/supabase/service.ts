import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { VideoDatabase } from "@/types/video-database";
import { getSupabaseEnv } from "./config";

// The catalog owner UUID is an identifier, not a credential. Atlas Irwin is a
// single-owner application, so production-mode builds can safely use the
// canonical owner when Vercel Preview does not inherit PUBLIC_CATALOG_OWNER_ID.
const ATLAS_PUBLIC_CATALOG_OWNER_ID =
  "c8d2e5a6-148c-4997-859a-b3e7bd75b54e";

export function createServiceClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for server catalog operations.",
    );
  }
  return createClient<VideoDatabase>(url, serviceRoleKey, {
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
  if (process.env.NODE_ENV === "production") {
    return ATLAS_PUBLIC_CATALOG_OWNER_ID;
  }
  return null;
}
