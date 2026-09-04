"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveArtistContext, resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { providerStateToDistributionState, type DistributionState } from "@/lib/distribution/domain";
import { getDistributionStatusForAccount } from "@/lib/distribution/provider-status";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

type Db = SupabaseClient<DistributionDatabase>;

function text(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown): Json {
  return value as Json;
}

function aggregateDeliveryState(states: DistributionState[]): DistributionState {
  if (!states.length) return "submitted";
  if (states.some((state) => state === "error")) return "error";
  if (states.some((state) => state === "rejected")) return "rejected";
  if (states.every((state) => state === "taken_down")) return "taken_down";
  if (states.some((state) => state === "takedown_pending")) return "takedown_pending";
  if (states.every((state) => state === "live")) return "live";
  if (states.some((state) => state === "live")) return "partially_live";
  if (states.every((state) => ["delivered", "live"].includes(state))) return "delivered";
  if (states.some((state) => ["delivering", "delivered"].includes(state))) return "delivering";
  if (states.some((state) => state === "under_review")) return "under_review";
  if (states.some((state) => state === "approved")) return "approved";
  return "submitted";
}

export async function syncDistributionStatus(form: FormData) {
  const releaseId = text(form, "release_id");
  if (!releaseId) throw new Error("Release ID is required.");
  const { supabase, user } = await requireStudioAdmin();
  const requestedArtistId = text(form, "artist_id");
  const artist = requestedArtistId
    ? await resolveArtistContext(supabase, user, requestedArtistId)
    : await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;
  const [releaseResult, configResult, accountResult, submissionResult] = await Promise.all([
    db.from("releases").select("id").eq("id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("release_distribution_configs").select("*").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").maybeSingle(),
    db.from("distribution_submissions").select("id").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const result of [releaseResult, configResult, accountResult, submissionResult]) if (result.error) throw new Error(result.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  const config = configResult.data;
  const account = accountResult.data;
  if (!config?.provider_release_id) throw new Error("Provider release is not prepared yet.");
  if (!account) throw new Error("Distribution account is not configured.");

  const deliveries = await getDistributionStatusForAccount(account, config.provider_release_id);
  const now = new Date().toISOString();
  const latestSubmissionId = submissionResult.data?.id ?? null;
  if (deliveries.length) {
    const rows = deliveries.map((delivery) => {
      const state = providerStateToDistributionState(delivery.providerStatus);
      return {
        owner_id: user.id,
        artist_id: artist.artistId,
        release_id: releaseId,
        submission_id: latestSubmissionId,
        provider: config.provider,
        store_id: delivery.storeId,
        store_name: delivery.storeName,
        state,
        provider_status: delivery.providerStatus == null ? null : String(delivery.providerStatus),
        store_url: delivery.url ?? null,
        raw_status: json(delivery.raw ?? {}),
        delivered_at: ["delivered", "live"].includes(state) ? now : null,
        live_at: state === "live" ? now : null,
        last_synced_at: now,
        updated_at: now,
      };
    });
    const upsert = await db.from("distribution_deliveries").upsert(rows, { onConflict: "release_id,provider,store_id" });
    if (upsert.error) throw new Error(upsert.error.message);

    const reconcile = await db.from("distribution_provider_operations").update({
      state: "resolved",
      result_snapshot: json({ reconciledByStatus: true, deliveryCount: deliveries.length }),
      completed_at: now,
    }).eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("release_id", releaseId).in("operation_type", ["submit", "takedown"]).in("state", ["started", "ambiguous"]);
    if (reconcile.error) throw new Error(reconcile.error.message);
  }

  const state = aggregateDeliveryState(deliveries.map((delivery) => providerStateToDistributionState(delivery.providerStatus)));
  const update = await db.from("release_distribution_configs").update({ state, last_synced_at: now }).eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId);
  if (update.error) throw new Error(update.error.message);
  const event = await db.from("distribution_events").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    release_id: releaseId,
    submission_id: latestSubmissionId,
    event_type: "distribution.status_synced",
    actor_type: "provider",
    provider: config.provider,
    payload: json({ state, deliveryCount: deliveries.length }),
  });
  if (event.error) throw new Error(event.error.message);

  revalidatePath("/studio/distribution");
  revalidatePath("/studio/distribution/operations");
  revalidatePath(`/studio/releases/${releaseId}`);
  revalidatePath(`/studio/releases/${releaseId}/distribution`);
}