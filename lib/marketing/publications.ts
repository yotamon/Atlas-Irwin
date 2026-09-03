import "server-only";

import { getSiteUrl } from "@/lib/site-url";
import type { Json } from "@/types/database";
import { channelAdapter } from "./channels";
import { createMarketingServiceClient } from "./db";
import type { MarketingExecutionScope } from "./execution-scope";

const PROVIDER_SCHEDULE_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

function payloadObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function text(value: Json | undefined) {
  return typeof value === "string" ? value : null;
}

function json(value: unknown) {
  return value as Json;
}

function inFuture(value: string | null) {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

async function markPublicationPublished(job: {
  id: string;
  owner_id: string;
  artist_id: string;
  campaign_id: string | null;
  content_item_id: string | null;
  content_variant_id: string | null;
  platform: string;
  external_post_id: string | null;
  external_url: string | null;
}, publishedAt: string, result: Json = {}) {
  const client = createMarketingServiceClient();
  const { error: publishError } = await client.from("publication_jobs").update({
    status: "published",
    published_at: publishedAt,
    result,
    last_error: null,
  }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  if (publishError) throw new Error(publishError.message);
  if (job.content_variant_id) {
    await client.from("content_variants").update({
      status: "published",
      published_at: publishedAt,
      external_post_id: job.external_post_id,
    }).eq("id", job.content_variant_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  }
  if (job.content_item_id) {
    await client.from("content_items").update({
      status: "Published",
      published_at: publishedAt,
      schedule_locked: true,
    }).eq("id", job.content_item_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
  }
  await client.from("marketing_events").insert({
    owner_id: job.owner_id,
    artist_id: job.artist_id,
    campaign_id: job.campaign_id,
    event_type: "content.published",
    entity_type: "content_item",
    entity_id: job.content_item_id,
    payload: {
      publicationJobId: job.id,
      externalPostId: job.external_post_id,
      externalUrl: job.external_url,
      platform: job.platform,
    },
  });
}

async function reconcileProviderScheduledPublications(limit = 20, scope?: MarketingExecutionScope) {
  const client = createMarketingServiceClient();
  const now = new Date().toISOString();
  let query = client
    .from("publication_jobs")
    .select("*")
    .eq("status", "provider_scheduled")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (scope) query = query.eq("owner_id", scope.ownerId).eq("artist_id", scope.artistId);
  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);

  let published = 0;
  let failed = 0;
  let pending = 0;
  for (const job of jobs ?? []) {
    if (!job.artist_id) {
      await client.from("publication_jobs").update({
        status: "failed",
        last_error: "Artist scope is missing; provider reconciliation is blocked.",
      }).eq("id", job.id);
      failed += 1;
      continue;
    }
    if (!job.external_post_id) {
      await client.from("publication_jobs").update({
        status: "failed",
        last_error: "Provider-scheduled publication has no external post ID to reconcile.",
      }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
      failed += 1;
      continue;
    }
    const adapter = channelAdapter(job.platform);
    if (!adapter.fetchPublicationStatus) {
      pending += 1;
      continue;
    }
    try {
      const provider = await adapter.fetchPublicationStatus(job.owner_id, job.external_post_id);
      if (provider.status === "scheduled") {
        await client.from("publication_jobs").update({ result: provider.details ?? {}, last_error: null })
          .eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        pending += 1;
        continue;
      }
      if (provider.status === "failed") {
        await client.from("publication_jobs").update({
          status: "failed",
          result: provider.details ?? {},
          last_error: "The provider reported that the scheduled publication failed.",
        }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        if (job.content_item_id) {
          await client.from("content_items").update({ status: "Ready", schedule_locked: false })
            .eq("id", job.content_item_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        }
        await client.from("marketing_events").insert({
          owner_id: job.owner_id,
          artist_id: job.artist_id,
          campaign_id: job.campaign_id,
          event_type: "publication.failed",
          entity_type: "content_item",
          entity_id: job.content_item_id,
          payload: { publicationJobId: job.id, platform: job.platform, provider: provider.details ?? {} },
        });
        failed += 1;
        continue;
      }
      await markPublicationPublished(job, provider.publishedAt ?? new Date().toISOString(), provider.details ?? {});
      published += 1;
    } catch (error) {
      await client.from("publication_jobs").update({
        last_error: error instanceof Error ? error.message : "Provider schedule reconciliation failed.",
      }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
      pending += 1;
    }
  }
  return { considered: jobs?.length ?? 0, published, failed, pending };
}

export async function processDuePublicationJobs(limit = 20, scope?: MarketingExecutionScope) {
  const client = createMarketingServiceClient();
  const dispatchHorizon = new Date(Date.now() + PROVIDER_SCHEDULE_LEAD_MS).toISOString();
  const reconciliation = await reconcileProviderScheduledPublications(limit, scope);
  let query = client
    .from("publication_jobs")
    .select("*")
    .in("status", ["approved", "scheduled"])
    .or(`scheduled_at.is.null,scheduled_at.lte.${dispatchHorizon}`)
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(limit * 2, 50)));
  if (scope) query = query.eq("owner_id", scope.ownerId).eq("artist_id", scope.artistId);
  const { data: jobs, error } = await query;
  if (error) throw new Error(error.message);

  let published = 0;
  let providerScheduled = 0;
  let manualReady = 0;
  let failed = 0;
  let deferred = 0;
  for (const job of jobs ?? []) {
    if (!job.artist_id) {
      await client.from("publication_jobs").update({
        status: "failed",
        last_error: "Artist scope is missing; publication is blocked.",
      }).eq("id", job.id);
      failed += 1;
      continue;
    }

    const adapter = channelAdapter(job.platform);
    const future = inFuture(job.scheduled_at);
    if (future && !adapter.capability().providerScheduling) {
      deferred += 1;
      continue;
    }

    const { data: claimed, error: claimError } = await client
      .from("publication_jobs")
      .update({ status: "publishing", attempt_count: job.attempt_count + 1 })
      .eq("id", job.id)
      .eq("owner_id", job.owner_id)
      .eq("artist_id", job.artist_id)
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
          .eq("owner_id", job.owner_id)
          .eq("artist_id", job.artist_id)
          .maybeSingle();
        if (variant?.attribution_code) attributionUrl = `${getSiteUrl()}/go/${variant.attribution_code}`;
      }
      const { data: sourceContent, error: sourceContentError } = job.content_item_id
        ? await client.from("content_items").select("source,format")
            .eq("id", job.content_item_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id).maybeSingle()
        : { data: null, error: null };
      if (sourceContentError) throw new Error(sourceContentError.message);
      const publicationMetadata = json({
        ...requestPayload,
        artistId: job.artist_id,
        source: sourceContent?.source ?? requestPayload.source ?? null,
        format: sourceContent?.format ?? requestPayload.format ?? null,
        aiGenerated: sourceContent?.source === "ai" || requestPayload.aiGenerated === true,
      });
      const result = await adapter.publish({
        ownerId: job.owner_id,
        artistId: job.artist_id,
        platform: job.platform,
        caption: text(requestPayload.caption),
        hookText: text(requestPayload.hookText),
        cta: text(requestPayload.cta),
        assetUrl: text(requestPayload.assetUrl),
        scheduledAt: job.scheduled_at,
        attributionUrl,
        metadata: publicationMetadata,
      });

      if (result.status === "manual_handoff") {
        const { error: handoffError } = await client.from("publication_jobs").update({
          status: "manual_ready",
          result: result.details ?? {},
          last_error: null,
        }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        if (handoffError) throw new Error(handoffError.message);
        manualReady += 1;
        continue;
      }

      if (result.status === "provider_scheduled") {
        if (!result.externalPostId) throw new Error("Provider schedule succeeded without an external post ID.");
        const { error: scheduleError } = await client.from("publication_jobs").update({
          status: "provider_scheduled",
          external_post_id: result.externalPostId,
          external_url: result.externalUrl ?? null,
          result: result.details ?? {},
          last_error: null,
        }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        if (scheduleError) throw new Error(scheduleError.message);
        if (job.content_variant_id) {
          await client.from("content_variants").update({ status: "scheduled", external_post_id: result.externalPostId })
            .eq("id", job.content_variant_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        }
        if (job.content_item_id) {
          await client.from("content_items").update({ status: "Scheduled", schedule_locked: true })
            .eq("id", job.content_item_id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
        }
        await client.from("marketing_events").insert({
          owner_id: job.owner_id,
          artist_id: job.artist_id,
          campaign_id: job.campaign_id,
          event_type: "publication.provider_scheduled",
          entity_type: "content_item",
          entity_id: job.content_item_id,
          payload: {
            publicationJobId: job.id,
            externalPostId: result.externalPostId,
            externalUrl: result.externalUrl ?? null,
            platform: job.platform,
            scheduledAt: job.scheduled_at,
          },
        });
        providerScheduled += 1;
        continue;
      }

      const publishedAt = new Date().toISOString();
      const externalJob = {
        ...job,
        external_post_id: result.externalPostId ?? null,
        external_url: result.externalUrl ?? null,
      };
      const { error: identityError } = await client.from("publication_jobs").update({
        external_post_id: externalJob.external_post_id,
        external_url: externalJob.external_url,
      }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
      if (identityError) throw new Error(identityError.message);
      await markPublicationPublished(externalJob, publishedAt, result.details ?? {});
      published += 1;
    } catch (error) {
      const attempts = job.attempt_count + 1;
      const terminal = attempts >= job.max_attempts;
      const backoffMinutes = Math.min(360, 5 * (2 ** Math.max(0, attempts - 1)));
      await client.from("publication_jobs").update({
        status: terminal ? "failed" : "scheduled",
        scheduled_at: terminal ? job.scheduled_at : new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString(),
        last_error: error instanceof Error ? error.message : "Publication failed.",
      }).eq("id", job.id).eq("owner_id", job.owner_id).eq("artist_id", job.artist_id);
      failed += 1;
    }
  }

  return {
    considered: jobs?.length ?? 0,
    published,
    providerScheduled,
    manualReady,
    failed,
    deferred,
    reconciledPublished: reconciliation.published,
    reconciliationFailed: reconciliation.failed,
    reconciliationPending: reconciliation.pending,
  };
}
