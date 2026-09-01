import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createMarketingServiceClient } from "./db";
import type { CreativeMoneyQuote } from "./creative-provider-types";
import type {
  CampaignAiSpendEnvelope,
  CampaignAiSpendReservation,
  CreativeSpendDatabase,
} from "@/types/creative-spend-database";

function db() {
  return createMarketingServiceClient() as unknown as SupabaseClient<CreativeSpendDatabase>;
}

export function campaignReservationUsd(quote: CreativeMoneyQuote) {
  const amount = Number(quote.amount);
  const reserve = Number(quote.reserveAmount);
  if (!Number.isFinite(amount) || !Number.isFinite(reserve) || amount <= 0 || reserve <= 0) return null;
  if (quote.currency === "USD") return Number(reserve.toFixed(4));
  const usd = Number(quote.usdEstimate);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return Number((usd * Math.max(1, reserve / amount)).toFixed(4));
}

export async function campaignSpendEnvelope(ownerId: string, campaignId: string) {
  const client = db();
  const { data, error } = await client.from("campaign_ai_spend_envelopes")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CampaignAiSpendEnvelope | null;
}

export async function reserveCampaignAiSpend(input: {
  ownerId: string;
  campaignId: string;
  generationRunId: string;
  mediaKind: "image" | "video";
  reserveUsd: number;
}) {
  const client = db();
  const { data, error } = await client.rpc("reserve_campaign_ai_spend", {
    p_owner_id: input.ownerId,
    p_campaign_id: input.campaignId,
    p_generation_run_id: input.generationRunId,
    p_media_kind: input.mediaKind,
    p_amount_usd: Number(input.reserveUsd.toFixed(4)),
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Campaign AI spend reservation returned no row.");
  return data as CampaignAiSpendReservation;
}

export async function reservationForGeneration(ownerId: string, generationRunId: string) {
  const client = db();
  const { data, error } = await client.from("campaign_ai_spend_reservations")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("generation_run_id", generationRunId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as CampaignAiSpendReservation | null;
}

export async function settleCampaignAiSpend(input: {
  ownerId: string;
  reservationId: string;
  actualUsd: number | null;
  basis: "provider_actual" | "estimated" | "conservative_reserve" | "not_billed";
}) {
  const client = db();
  const { data, error } = await client.rpc("settle_campaign_ai_spend", {
    p_owner_id: input.ownerId,
    p_reservation_id: input.reservationId,
    p_actual_usd: input.actualUsd,
    p_basis: input.basis,
  });
  if (error) throw new Error(error.message);
  return data as CampaignAiSpendReservation;
}

export async function releaseCampaignAiSpend(input: {
  ownerId: string;
  reservationId: string;
  reason: string;
}) {
  const client = db();
  const { data, error } = await client.rpc("release_campaign_ai_spend", {
    p_owner_id: input.ownerId,
    p_reservation_id: input.reservationId,
    p_reason: input.reason.slice(0, 500),
  });
  if (error) throw new Error(error.message);
  return data as CampaignAiSpendReservation;
}

export async function settleCampaignSpendForGeneration(input: {
  ownerId: string;
  generationRunId: string;
  actualUsd: number | null;
  basis: "provider_actual" | "estimated" | "conservative_reserve" | "not_billed";
}) {
  const reservation = await reservationForGeneration(input.ownerId, input.generationRunId);
  if (!reservation || reservation.status !== "reserved") return reservation;
  return settleCampaignAiSpend({
    ownerId: input.ownerId,
    reservationId: reservation.id,
    actualUsd: input.actualUsd,
    basis: input.basis,
  });
}

export async function releaseCampaignSpendForGeneration(input: {
  ownerId: string;
  generationRunId: string;
  reason: string;
}) {
  const reservation = await reservationForGeneration(input.ownerId, input.generationRunId);
  if (!reservation || reservation.status !== "reserved") return reservation;
  return releaseCampaignAiSpend({
    ownerId: input.ownerId,
    reservationId: reservation.id,
    reason: input.reason,
  });
}
