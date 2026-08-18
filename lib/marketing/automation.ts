import "server-only";

import { randomBytes } from "node:crypto";
import { channelAdapter } from "./channels";
import { createMarketingServiceClient } from "./db";
import { aggregateMetrics, primarySignalValue } from "./domain";
import { releaseRelativeTimestamp } from "./schedule";
import type { Json } from "@/types/database";
import type {
  AutomationJob,
  CampaignExperiment,
  ContentVariant,
} from "@/types/marketing-database";

function asJson(value: unknown) {
  return value as Json;
}

function objectPayload(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function stringPayload(value: Json | undefined) {
  return typeof value === "string" && value ? value : null;
}

function newAttributionCode() {
  return `ai_${randomBytes(7).toString("base64url")}`;
}

function isDuplicate(message: string) {
  return message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique");
}

async function enqueueJob({
  ownerId,
  campaignId,
  sourceEventId,
  jobType,
  payload,
  runAfter,
  requiresApproval = false,
  idempotencyKey,
}: {
  ownerId: string;
  campaignId: string | null;
  sourceEventId?: string | null;
  jobType: string;
  payload: unknown;
  runAfter?: string;
  requiresApproval?: boolean;
  idempotencyKey: string;
}) {
  const client = createMarketingServiceClient();
  const { error } = await client.from("automation_jobs").insert({
    owner_id: ownerId,
    campaign_id: campaignId,
    source_event_id: sourceEventId ?? null,
    job_type: jobType,
    payload: asJson(payload),
    status: requiresApproval ? "awaiting_approval" : "queued",
    requires_approval: requiresApproval,
    approval_status: requiresApproval ? "pending" : "not_required",
    run_after: runAfter ?? new Date().toISOString(),
    idempotency_key: idempotencyKey,
  });
  if (error && !isDuplicate(error.message)) throw new Error(error.message);
}

export async function processMarketingEvents(limit = 50) {
  const client = createMarketingServiceClient();
  const { data: events, error } = await client
    .from("marketing_events")
    .select("*")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(error.message);

  let processed = 0;
  for (const event of events ?? []) {
    const payload = objectPayload(event.payload);
    if (event.event_type === "metrics.updated") {
      const experimentId = stringPayload(payload.experimentId);
      if (experimentId) {
        await enqueueJob({
          ownerId: event.owner_id,
          campaignId: event.campaign_id,
          sourceEventId: event.id,
          jobType: "evaluate_experiment",
          payload: { experimentId },
          idempotencyKey: `event:${event.id}:evaluate:${experimentId}`,
        });
      }
    }

    if (event.event_type === "content.published" && event.entity_id) {
      for (const hours of [24, 72, 168]) {
        await enqueueJob({
          ownerId: event.owner_id,
          campaignId: event.campaign_id,
          sourceEventId: event.id,
          jobType: "collect_metrics",
          payload: { contentItemId: event.entity_id, hoursAfterPublish: hours },
          runAfter: new Date(new Date(event.occurred_at).getTime() + hours * 60 * 60 * 1000).toISOString(),
          idempotencyKey: `event:${event.id}:metrics:${hours}`,
        });
      }
    }

    const { error: markError } = await client
      .from("marketing_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (markError) throw new Error(markError.message);
    processed += 1;
  }
  return processed;
}

function variantSummary(
  variant: ContentVariant,
  metrics: Array<Record<string, unknown>>,
  experiment: CampaignExperiment,
) {
  const rows = metrics.filter((metric) => metric.content_variant_id === variant.id);
  const aggregate = aggregateMetrics(rows);
  return {
    variant,
    aggregate,
    sample: Math.max(aggregate.reach ?? 0, aggregate.views ?? 0),
    signal: primarySignalValue(experiment.goal, aggregate),
  };
}

async function evaluateExperimentJob(job: AutomationJob) {
  const client = createMarketingServiceClient();
  const payload = objectPayload(job.payload);
  const experimentId = stringPayload(payload.experimentId);
  if (!experimentId) throw new Error("evaluate_experiment job is missing experimentId.");

  const [experimentResult, variantsResult, metricsResult] = await Promise.all([
    client.from("campaign_experiments").select("*").eq("id", experimentId).single(),
    client.from("content_variants").select("*").eq("experiment_id", experimentId),
    client.from("metric_snapshots").select("*").eq("experiment_id", experimentId),
  ]);
  if (experimentResult.error) throw new Error(experimentResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  const experiment = experimentResult.data;
  const summaries = (variantsResult.data ?? [])
    .map((variant) => variantSummary(variant, metricsResult.data as unknown as Array<Record<string, unknown>>, experiment))
    .filter((summary) => summary.sample >= experiment.minimum_sample)
    .sort((a, b) => b.signal - a.signal);

  if (summaries.length < 2) {
    const result = `Need at least two variants with ${experiment.minimum_sample.toLocaleString()} qualified observations.`;
    await client.from("campaign_experiments").update({ status: "evaluating", result_summary: result }).eq("id", experiment.id);
    return { outcome: "waiting_for_sample", result };
  }

  const [best, second] = summaries;
  const lift = second.signal > 0 ? (best.signal - second.signal) / second.signal : best.signal > 0 ? 1 : 0;
  if (lift < Number(experiment.minimum_lift)) {
    const result = `No reliable winner. Current lift is ${(lift * 100).toFixed(1)}%, below the ${(Number(experiment.minimum_lift) * 100).toFixed(0)}% threshold.`;
    await client.from("campaign_experiments").update({ status: "inconclusive", winner_variant_id: null, result_summary: result }).eq("id", experiment.id);
    return { outcome: "inconclusive", lift, result };
  }

  const result = `Variant ${best.variant.label} leads by ${(lift * 100).toFixed(1)}% on ${experiment.primary_metric}.`;
  const { error: winnerError } = await client.from("campaign_experiments").update({
    status: "winner_found",
    winner_variant_id: best.variant.id,
    result_summary: result,
  }).eq("id", experiment.id);
  if (winnerError) throw new Error(winnerError.message);

  const { data: campaign, error: campaignError } = await client
    .from("campaigns")
    .select("mode,release_id")
    .eq("id", experiment.campaign_id)
    .single();
  if (campaignError) throw new Error(campaignError.message);

  const evidence = {
    metric: experiment.primary_metric,
    lift,
    winner: { id: best.variant.id, label: best.variant.label, signal: best.signal, sample: best.sample, hook: best.variant.hook_text },
    runnerUp: { id: second.variant.id, label: second.variant.label, signal: second.signal, sample: second.sample },
  };
  const { data: existingLearning } = await client
    .from("marketing_learnings")
    .select("id")
    .eq("experiment_id", experiment.id)
    .eq("source", "experiment")
    .limit(1)
    .maybeSingle();
  const learningRow = {
    owner_id: experiment.owner_id,
    campaign_id: experiment.campaign_id,
    release_id: campaign.release_id,
    experiment_id: experiment.id,
    scope: "experiment" as const,
    finding: `${experiment.title}: variant ${best.variant.label} is the current winning framing. ${best.variant.hook_text ?? ""}`.trim(),
    evidence: asJson(evidence),
    confidence: Math.min(0.95, 0.55 + Math.min(lift, 1) * 0.3 + Math.min(best.sample / 5000, 1) * 0.1),
    status: "proposed" as const,
    applies_to: asJson({ goal: experiment.goal }),
    source: "experiment" as const,
  };
  const learningMutation = existingLearning
    ? client.from("marketing_learnings").update(learningRow).eq("id", existingLearning.id)
    : client.from("marketing_learnings").insert(learningRow);
  const { error: learningError } = await learningMutation;
  if (learningError) throw new Error(learningError.message);

  const requiresApproval = campaign.mode !== "autopilot";
  await enqueueJob({
    ownerId: experiment.owner_id,
    campaignId: experiment.campaign_id,
    jobType: "generate_winner_derivatives",
    payload: { experimentId: experiment.id, winnerVariantId: best.variant.id },
    requiresApproval,
    idempotencyKey: `winner-derivatives:${experiment.id}:${best.variant.id}`,
  });

  await client.from("marketing_events").insert({
    owner_id: experiment.owner_id,
    campaign_id: experiment.campaign_id,
    event_type: "experiment.winner_found",
    entity_type: "campaign_experiment",
    entity_id: experiment.id,
    payload: asJson({ winnerVariantId: best.variant.id, lift }),
  });
  return { outcome: "winner_found", winnerVariantId: best.variant.id, lift, result };
}

async function generateWinnerDerivatives(job: AutomationJob) {
  const client = createMarketingServiceClient();
  const payload = objectPayload(job.payload);
  const winnerVariantId = stringPayload(payload.winnerVariantId);
  if (!winnerVariantId) throw new Error("generate_winner_derivatives job is missing winnerVariantId.");

  const { data: winner, error: winnerError } = await client.from("content_variants").select("*").eq("id", winnerVariantId).single();
  if (winnerError) throw new Error(winnerError.message);
  const { data: sourceItem, error: itemError } = await client.from("content_items").select("*").eq("id", winner.content_item_id).single();
  if (itemError) throw new Error(itemError.message);
  if (!sourceItem.campaign_id) throw new Error("Winner content is not attached to a campaign.");
  const { data: campaign, error: campaignError } = await client.from("campaigns").select("mode,release_anchor_date").eq("id", sourceItem.campaign_id).single();
  if (campaignError) throw new Error(campaignError.message);
  const { data: sourceLink } = await client.from("attribution_links").select("destination_url").eq("content_variant_id", winner.id).limit(1).maybeSingle();

  const targetPlatforms = ["Instagram", "TikTok", "YouTube Shorts"].filter((platform) => platform !== sourceItem.platform).slice(0, 2);
  const createdIds: string[] = [];
  for (const [index, platform] of targetPlatforms.entries()) {
    const relativeDay = (sourceItem.relative_day ?? 0) + 2 + index * 2;
    const scheduledAt = releaseRelativeTimestamp(campaign.release_anchor_date, relativeDay);
    const approval = campaign.mode === "autopilot" ? "not_required" : "pending";
    const format = platform === "TikTok" ? "TikTok video" : platform === "YouTube Shorts" ? "Short" : "Reel";
    const { data: item, error: createError } = await client.from("content_items").insert({
      owner_id: sourceItem.owner_id,
      release_id: sourceItem.release_id,
      campaign_id: sourceItem.campaign_id,
      phase_id: sourceItem.phase_id,
      experiment_id: sourceItem.experiment_id,
      title: `${sourceItem.title} / winner derivative / ${platform}`,
      platform,
      format,
      status: "Draft",
      goal: sourceItem.goal,
      scheduled_at: scheduledAt,
      approval_status: approval,
      source: "automation",
      generated_from_run_id: winner.generation_run_id,
      content_angle: sourceItem.content_angle,
      audience_segment: sourceItem.audience_segment,
      relative_day: relativeDay,
      schedule_locked: false,
      schedule_local_time: sourceItem.schedule_local_time,
      schedule_timezone: sourceItem.schedule_timezone,
      hook_text: winner.hook_text,
      caption: winner.caption,
      cta: winner.cta,
      visual_prompt: winner.visual_prompt,
      production_notes: `${winner.production_notes ?? ""}\nAdapt the proven framing to ${platform} without changing the core hypothesis.`.trim(),
    }).select("id").single();
    if (createError) throw new Error(createError.message);
    createdIds.push(item.id);

    const code = sourceLink?.destination_url ? newAttributionCode() : null;
    const { data: derivative, error: variantError } = await client.from("content_variants").insert({
      owner_id: sourceItem.owner_id,
      content_item_id: item.id,
      experiment_id: winner.experiment_id,
      generation_run_id: winner.generation_run_id,
      label: "winner-derivative",
      hypothesis: winner.hypothesis,
      hook_text: winner.hook_text,
      caption: winner.caption,
      cta: winner.cta,
      visual_prompt: winner.visual_prompt,
      production_notes: `Derivative of winning variant ${winner.label}.`,
      status: campaign.mode === "autopilot" ? "approved" : "draft",
      approval_status: approval,
      is_control: true,
      scheduled_at: scheduledAt,
      attribution_code: code,
    }).select("id").single();
    if (variantError) throw new Error(variantError.message);
    if (code && sourceLink?.destination_url) {
      const { error: linkError } = await client.from("attribution_links").insert({
        owner_id: sourceItem.owner_id,
        campaign_id: sourceItem.campaign_id,
        content_item_id: item.id,
        content_variant_id: derivative.id,
        code,
        platform,
        destination_url: sourceLink.destination_url,
        label: `${sourceItem.title} winner derivative / ${platform}`,
      });
      if (linkError) throw new Error(linkError.message);
    }
  }

  await client.from("marketing_events").insert({
    owner_id: sourceItem.owner_id,
    campaign_id: sourceItem.campaign_id,
    event_type: "content.derivatives_created",
    entity_type: "content_variant",
    entity_id: winner.id,
    payload: asJson({ createdContentItemIds: createdIds }),
  });
  return { createdContentItemIds: createdIds };
}

async function collectMetricsJob(job: AutomationJob) {
  const client = createMarketingServiceClient();
  const payload = objectPayload(job.payload);
  const contentItemId = stringPayload(payload.contentItemId);
  if (!contentItemId) throw new Error("collect_metrics job is missing contentItemId.");
  const { data: item, error: itemError } = await client.from("content_items").select("*").eq("id", contentItemId).single();
  if (itemError) throw new Error(itemError.message);
  const { data: publication } = await client
    .from("publication_jobs")
    .select("*")
    .eq("content_item_id", contentItemId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!publication?.external_post_id) {
    return { outcome: "manual_metrics_required", reason: "No published external post ID is attached yet." };
  }

  const adapter = channelAdapter(item.platform);
  const metrics = await adapter.fetchMetrics(publication.external_post_id);
  if (!metrics) {
    return { outcome: "manual_metrics_required", reason: adapter.capability().reason ?? "Channel metrics are not automated." };
  }
  const numeric = (key: string) => Math.max(0, Math.round(Number(metrics[key]) || 0));
  const { error: metricError } = await client.from("metric_snapshots").insert({
    owner_id: item.owner_id,
    date: new Date().toISOString().slice(0, 10),
    platform: item.platform,
    release_id: item.release_id,
    content_item_id: item.id,
    campaign_id: item.campaign_id,
    experiment_id: item.experiment_id,
    content_variant_id: publication.content_variant_id,
    source: publication.adapter,
    external_object_id: publication.external_post_id,
    captured_at: new Date().toISOString(),
    reach: numeric("reach"),
    views: numeric("views"),
    watch_time: numeric("watch_time"),
    likes: numeric("likes"),
    comments: numeric("comments"),
    shares: numeric("shares"),
    saves: numeric("saves"),
    profile_visits: numeric("profile_visits"),
    follows: numeric("follows"),
    link_clicks: numeric("link_clicks"),
    streams: numeric("streams"),
    listeners: numeric("listeners"),
    playlist_adds: numeric("playlist_adds"),
  });
  if (metricError) throw new Error(metricError.message);
  return { outcome: "metrics_collected", externalPostId: publication.external_post_id };
}

async function processJob(job: AutomationJob) {
  if (job.job_type === "evaluate_experiment") return evaluateExperimentJob(job);
  if (job.job_type === "generate_winner_derivatives") return generateWinnerDerivatives(job);
  if (job.job_type === "collect_metrics") return collectMetricsJob(job);
  return { outcome: "unsupported_job", jobType: job.job_type };
}

export async function runDueAutomationJobs(limit = 20) {
  const client = createMarketingServiceClient();
  const rpcClient = client as unknown as {
    rpc: (
      fn: "claim_marketing_automation_jobs",
      args: { p_limit: number },
    ) => Promise<{ data: AutomationJob[] | null; error: { message: string } | null }>;
  };
  const { data: jobs, error } = await rpcClient.rpc("claim_marketing_automation_jobs", {
    p_limit: Math.max(1, Math.min(limit, 100)),
  });
  if (error) throw new Error(error.message);

  let completed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    try {
      const result = await processJob(job);
      const { error: completeError } = await client.from("automation_jobs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        locked_at: null,
        result: asJson(result),
        error: null,
      }).eq("id", job.id);
      if (completeError) throw new Error(completeError.message);
      completed += 1;
    } catch (error) {
      const terminal = job.attempt_count >= job.max_attempts;
      const backoffHours = Math.min(24, Math.max(1, 2 ** Math.max(0, job.attempt_count - 1)));
      await client.from("automation_jobs").update({
        status: terminal ? "failed" : "queued",
        locked_at: null,
        run_after: new Date(Date.now() + backoffHours * 60 * 60 * 1000).toISOString(),
        error: error instanceof Error ? error.message : "Automation job failed.",
      }).eq("id", job.id);
      failed += 1;
    }
  }
  return { claimed: jobs?.length ?? 0, completed, failed };
}

export async function runMarketingAutomationCycle() {
  const processedEvents = await processMarketingEvents();
  const jobs = await runDueAutomationJobs();
  return { processedEvents, ...jobs };
}
