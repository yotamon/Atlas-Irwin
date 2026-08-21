import "server-only";

import { channelAdapter } from "./channels";
import { createMarketingServiceClient } from "./db";
import { getSiteUrl } from "@/lib/site-url";
import type { Json } from "@/types/database";

function payloadObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : null;
}

export async function processDuePublicationJobs(limit = 20) {
  const client = createMarketingServiceClient();
  const now = new Date().toISOString();
  const { data: jobs, error } = await client
    .from("publication_jobs")
    .select("*")
    .in("status", ["approved", "scheduled"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${now}`)
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw new Error(error.message);

  let published = 0;
  let manualReady = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    const { data: claimed, error: claimError } = await client
      .from("publication_jobs")
      .update({ status: "publishing", attempt_count: job.attempt_count + 1 })
      .eq("id", job.id)
      .in("status", ["approved", "scheduled"])
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) continue;

    try {
      const requestPayload = payloadObject(job.request_payload);
      let attributionUrl: string | null = null;
      if (job.content_variant_id) {
        const { data: variant } = await client
          .from("content_variants")
          .select("attribution_code")
          .eq("id", job.content_variant_id)
          .maybeSingle();
        if (variant?.attribution_code) attributionUrl = `${getSiteUrl()}/go/${variant.attribution_code}`;
      }
      const adapter = channelAdapter(job.platform);
      const result = await adapter.publish({
        ownerId: job.owner_id,
        platform: job.platform,
        caption: text(requestPayload.caption),
        hookText: text(requestPayload.hookText),
        cta: text(requestPayload.cta),
        assetUrl: text(requestPayload.assetUrl),
        scheduledAt: job.scheduled_at,
        attributionUrl,
        metadata: job.request_payload,
      });

      if (result.status === "manual_handoff") {
        const { error: handoffError } = await client.from("publication_jobs").update({
          status: "manual_ready" as never,
          result: result.details ?? {},
          last_error: null,
        }).eq("id", job.id);
        if (handoffError) throw new Error(handoffError.message);
        manualReady += 1;
        continue;
      }

      const publishedAt = new Date().toISOString();
      const { error: publishError } = await client.from("publication_jobs").update({
        status: "published",
        published_at: publishedAt,
        external_post_id: result.externalPostId ?? null,
        external_url: result.externalUrl ?? null,
        result: result.details ?? {},
        last_error: null,
      }).eq("id", job.id);
      if (publishError) throw new Error(publishError.message);
      if (job.content_variant_id) {
        await client.from("content_variants").update({ status: "published", published_at: publishedAt, external_post_id: result.externalPostId ?? null }).eq("id", job.content_variant_id);
      }
      if (job.content_item_id) {
        await client.from("content_items").update({ status: "Published", published_at: publishedAt }).eq("id", job.content_item_id);
      }
      await client.from("marketing_events").insert({
        owner_id: job.owner_id,
        campaign_id: job.campaign_id,
        event_type: "content.published",
        entity_type: "content_item",
        entity_id: job.content_item_id,
        payload: {
          publicationJobId: job.id,
          externalPostId: result.externalPostId ?? null,
          externalUrl: result.externalUrl ?? null,
          platform: job.platform,
        },
      });
      published += 1;
    } catch (error) {
      const attempts = job.attempt_count + 1;
      const terminal = attempts >= job.max_attempts;
      const backoffMinutes = Math.min(360, 5 * (2 ** Math.max(0, attempts - 1)));
      await client.from("publication_jobs").update({
        status: terminal ? "failed" : "scheduled",
        scheduled_at: terminal ? job.scheduled_at : new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
        last_error: error instanceof Error ? error.message : "Publication failed.",
      }).eq("id", job.id);
      failed += 1;
    }
  }

  return { considered: jobs?.length ?? 0, published, manualReady, failed };
}
