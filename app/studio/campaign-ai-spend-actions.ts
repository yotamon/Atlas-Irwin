"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import type { CreativeSpendDatabase } from "@/types/creative-spend-database";

const uuid = z.uuid();
const money = z.coerce.number().finite().min(0).max(100000);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function checked(form: FormData, key: string) {
  return form.get(key) === "on" || form.get(key) === "true" || form.get(key) === "1";
}

export async function saveCampaignAiSpendEnvelope(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as SupabaseClient<CreativeSpendDatabase>;
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const enabled = checked(form, "enabled");
  const hardLimitUsd = money.parse(value(form, "hard_limit_usd") || "0");
  const maxSingleGenerationUsd = money.parse(value(form, "max_single_generation_usd") || "0");
  const allowImage = checked(form, "allow_image");
  const allowVideo = checked(form, "allow_video");
  const allowedMediaKinds = [allowImage ? "image" : null, allowVideo ? "video" : null]
    .filter((kind): kind is "image" | "video" => Boolean(kind));
  const expiresRaw = value(form, "expires_at");
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new Error("AI creative budget expiry is invalid.");
  if (!allowedMediaKinds.length) throw new Error("Allow at least one media kind for the campaign AI creative budget.");
  if (enabled && (hardLimitUsd <= 0 || maxSingleGenerationUsd <= 0)) {
    throw new Error("An enabled AI creative budget needs both a positive total cap and per-generation cap.");
  }
  if (maxSingleGenerationUsd > hardLimitUsd && hardLimitUsd > 0) {
    throw new Error("Per-generation cap cannot exceed the campaign AI creative budget.");
  }

  const { data: campaign, error: campaignError } = await db.from("campaigns")
    .select("id,mode")
    .eq("id", campaignId)
    .eq("owner_id", user.id)
    .single();
  if (campaignError || !campaign) throw new Error(campaignError?.message || "Campaign not found.");
  if (enabled && campaign.mode !== "autopilot") {
    throw new Error("Switch the campaign to Autopilot before enabling autonomous AI creative spend.");
  }

  const { data: existing, error: existingError } = await db.from("campaign_ai_spend_envelopes")
    .select("*")
    .eq("owner_id", user.id)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing && hardLimitUsd + 0.0001 < Number(existing.spent_usd) + Number(existing.reserved_usd)) {
    throw new Error(`The new cap cannot be below already committed spend ($${(Number(existing.spent_usd) + Number(existing.reserved_usd)).toFixed(2)}).`);
  }

  const row = {
    owner_id: user.id,
    campaign_id: campaignId,
    enabled,
    hard_limit_usd: Number(hardLimitUsd.toFixed(4)),
    max_single_generation_usd: Number(maxSingleGenerationUsd.toFixed(4)),
    allowed_media_kinds: allowedMediaKinds,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    overrun_usd: existing && hardLimitUsd >= Number(existing.spent_usd)
      ? 0
      : Number(existing?.overrun_usd ?? 0),
  };
  const mutation = existing
    ? db.from("campaign_ai_spend_envelopes").update(row).eq("id", existing.id).eq("owner_id", user.id)
    : db.from("campaign_ai_spend_envelopes").insert(row);
  const { error } = await mutation;
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/campaigns/${campaignId}`);
}

export async function disableCampaignAiSpendEnvelope(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as unknown as SupabaseClient<CreativeSpendDatabase>;
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const { error } = await db.from("campaign_ai_spend_envelopes")
    .update({ enabled: false })
    .eq("owner_id", user.id)
    .eq("campaign_id", campaignId);
  if (error) throw new Error(error.message);
  revalidatePath(`/studio/campaigns/${campaignId}`);
}
