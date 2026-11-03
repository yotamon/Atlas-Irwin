import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";
import { deriveDeliverySignal } from "./release-delivery-signal";

/**
 * Account and provider delivery are different records. Read both with explicit
 * owner/artist scopes; a published website must never substitute for DSP proof.
 * Fail closed when either read fails rather than showing a false "ready" state.
 */
export async function loadReleaseDeliverySignal(input: {
  db: SupabaseClient<Database>;
  ownerId: string;
  artistId: string;
  releaseId: string;
  releaseStatus: string | null;
}) {
  const db = input.db as unknown as SupabaseClient<DistributionDatabase>;
  const [accounts, config] = await Promise.all([
    db.from("distribution_accounts")
      .select("provider,status")
      .eq("owner_id", input.ownerId),
    db.from("release_distribution_configs")
      .select("provider,state")
      .eq("owner_id", input.ownerId)
      .eq("artist_id", input.artistId)
      .eq("release_id", input.releaseId)
      .maybeSingle(),
  ]);

  const configuredProvider = config.data?.provider ?? "revelator";
  const account = accounts.data?.find((row) => row.provider === configuredProvider);
  return deriveDeliverySignal({
    releaseIsLive: input.releaseStatus?.toLowerCase() === "live",
    providerState: config.data?.state ?? null,
    accountStatus: account?.status ?? null,
    evidenceUnavailable: Boolean(accounts.error || config.error),
  });
}
