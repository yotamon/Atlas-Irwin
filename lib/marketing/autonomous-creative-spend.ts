import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSpecialistMediaSpendAllowed } from "@/lib/ai/control-plane";
import { getSiteUrl } from "@/lib/site-url";
import { createMarketingServiceClient } from "./db";
import { applyMarketingCreativeProviderStatus } from "./creative-generation";
import {
  campaignReservationUsd,
  releaseCampaignAiSpend,
  reserveCampaignAiSpend,
} from "./campaign-ai-spend";
import {
  creativeProvider,
  isCreativeDefiniteRejection,
} from "./creative-providers";
import {
  CREATIVE_PROVIDER_IDS,
  type CreativeGenerationRequest,
  type CreativeMoneyQuote,
  type CreativeProviderId,
} from "./creative-provider-types";
import type { Json } from "@/types/database";
import type { CreativeSpendDatabase } from "@/types/creative-spend-database";

function record(value: Json | unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function json(value: unknown) {
  return value as Json;
}

function spendClient() {
  return createMarketingServiceClient() as unknown as SupabaseClient<CreativeSpendDatabase>;
}

function providerId(value: string): CreativeProviderId | null {
  return (CREATIVE_PROVIDER_IDS as readonly string[]).includes(value)
    ? value as CreativeProviderId
    : null;
}

function webhookUrl(provider: CreativeProviderId, runId: string) {
  if (provider !== "higgsfield") return undefined;
  const secret = process.env.HIGGSFIELD_WEBHOOK_SECRET?.trim();
  if (!secret) return undefined;
  const url = new URL("/api/studio/marketing/higgsfield/webhook", getSiteUrl());
  url.searchParams.set("token", secret);
  url.searchParams.set("run", runId);
  return url.toString();
}

function quoteFromOutput(output: Record<string, unknown>) {
  const value = output.quote;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const quote = value as Partial<CreativeMoneyQuote>;
  if ((quote.currency !== "USD" && quote.currency !== "CREDITS")
    || typeof quote.amount !== "number"
    || typeof quote.reserveAmount !== "number") return null;
  return quote as CreativeMoneyQuote;
}

async function eligibleCampaignIds(ownerId?: string) {
  const client = spendClient();
  let query = client.from("campaign_ai_spend_envelopes")
    .select("campaign_id,owner_id")
    .eq("enabled", true)
    .gt("hard_limit_usd", 0)
    .gt("max_single_generation_usd", 0);
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function processAutonomousCreativeSpend(limit = 4, ownerId?: string) {
  const client = spendClient();
  const envelopes = await eligibleCampaignIds(ownerId);
  if (!envelopes.length) return { considered: 0, submitted: 0, blocked: 0, ambiguous: 0 };
  const campaignIds = Array.from(new Set(envelopes.map((item) => item.campaign_id)));
  let query = client.from("generation_runs")
    .select("*")
    .in("campaign_id", campaignIds)
    .eq("status", "queued")
    .like("purpose", "content_asset:%")
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 10)));
  if (ownerId) query = query.eq("owner_id", ownerId);
  const { data: runs, error } = await query;
  if (error) throw new Error(error.message);

  let considered = 0;
  let submitted = 0;
  let blocked = 0;
  let ambiguous = 0;
  for (const run of runs ?? []) {
    const output = record(run.output);
    if (output.stage !== "prepared" || !run.campaign_id) continue;
    considered += 1;
    const inputContext = record(run.input_context);
    const productionGate = record(inputContext.productionGate);
    const kind = inputContext.outputKind;
    if (productionGate.passed !== true || (kind !== "image" && kind !== "video")) {
      blocked += 1;
      continue;
    }
    const requestValue = inputContext.request;
    const request = requestValue && typeof requestValue === "object" && !Array.isArray(requestValue)
      ? requestValue as unknown as CreativeGenerationRequest
      : null;
    const provider = providerId(run.provider);
    const quote = quoteFromOutput(output);
    const reserveUsd = quote ? campaignReservationUsd(quote) : null;
    if (!request || !provider || request.provider !== provider || !reserveUsd) {
      blocked += 1;
      continue;
    }

    let reservationId: string | null = null;
    try {
      await assertSpecialistMediaSpendAllowed({
        ownerId: run.owner_id,
        kind,
        estimatedUsd: reserveUsd,
      });
      const reservation = await reserveCampaignAiSpend({
        ownerId: run.owner_id,
        campaignId: run.campaign_id,
        generationRunId: run.id,
        mediaKind: kind,
        reserveUsd,
      });
      reservationId = reservation.id;

      const authorizedAt = new Date().toISOString();
      const { error: authorizeError } = await client.from("generation_runs").update({
        output: json({
          ...output,
          approvalRequiredBeforeSpend: false,
          autonomousSpend: {
            authorized: true,
            reservationId: reservation.id,
            reserveUsd: reservation.reserved_usd,
            authorizedAt,
            source: "campaign_envelope",
          },
        }),
        metadata: json({
          ...record(run.metadata),
          campaignSpendReservationId: reservation.id,
          autonomousSpendAuthorizedAt: authorizedAt,
        }),
      }).eq("id", run.id).eq("status", "queued");
      if (authorizeError) throw new Error(authorizeError.message);

      const adapter = creativeProvider(provider);
      const submission = await adapter.submit(request, webhookUrl(provider, run.id));
      await applyMarketingCreativeProviderStatus({ runId: run.id, status: submission });
      submitted += 1;
    } catch (submissionError) {
      const message = submissionError instanceof Error ? submissionError.message : "Autonomous creative submission failed.";
      if (reservationId && isCreativeDefiniteRejection(submissionError)) {
        await releaseCampaignAiSpend({
          ownerId: run.owner_id,
          reservationId,
          reason: `definite_pre_submission_rejection:${message}`,
        }).catch(() => undefined);
        await client.from("generation_runs").update({
          status: "failed",
          error: message,
          output: json({ ...output, stage: "failed_before_submission", autonomousSpendReleased: true }),
        }).eq("id", run.id);
        blocked += 1;
        continue;
      }
      if (reservationId) {
        await client.from("generation_runs").update({
          status: "running",
          error: message,
          output: json({
            ...output,
            stage: "submission_ambiguous",
            autonomousSpend: {
              reservationId,
              reserveLocked: true,
              warning: "Provider submission is ambiguous. Atlas will not retry automatically and the campaign reserve remains locked pending reconciliation.",
            },
          }),
        }).eq("id", run.id);
        ambiguous += 1;
        continue;
      }
      blocked += 1;
    }
  }
  return { considered, submitted, blocked, ambiguous };
}
