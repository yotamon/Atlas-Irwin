import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { LicensingDatabase } from "@/types/licensing-database";

function licensingClient() {
  return createServiceClient() as unknown as SupabaseClient<LicensingDatabase>;
}

export async function activeCapabilitiesForOwner(ownerId: string, now = new Date()): Promise<ReadonlySet<string>> {
  if (!ownerId.trim()) return new Set();
  const { data, error } = await licensingClient()
    .from("ensemblis_capability_grants")
    .select("capability,expires_at")
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
  const at = now.getTime();
  return new Set(
    (data ?? [])
      .filter((grant) => {
        if (!grant.expires_at) return true;
        const expiry = Date.parse(grant.expires_at);
        return Number.isFinite(expiry) && expiry >= at;
      })
      .map((grant) => grant.capability),
  );
}

export async function requireOwnerCapability(ownerId: string, capability: string) {
  const capabilities = await activeCapabilitiesForOwner(ownerId);
  if (!capabilities.has(capability)) {
    throw new Error(`Missing required Ensemblis capability: ${capability}.`);
  }
  return capabilities;
}
