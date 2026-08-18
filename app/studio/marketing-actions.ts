"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import {
  CAMPAIGN_MODES,
  CAMPAIGN_STATUSES,
  MARKETING_OBJECTIVES,
  OBJECTIVE_KPIS,
  aggregateMetrics,
  campaignPhasePlan,
  campaignWindow,
  formatRate,
  objectivePerformanceScore,
  primarySignalValue,
} from "@/lib/marketing/domain";
import { planCampaign, type CampaignPlanningContext } from "@/lib/marketing/planner";
import { releaseRelativeTimestamp } from "@/lib/marketing/schedule";
import type { Json } from "@/types/database";
import type {
  CampaignExperiment,
  ContentVariant,
} from "@/types/marketing-database";

const uuid = z.uuid();
const objectiveSchema = z.enum(MARKETING_OBJECTIVES);
const modeSchema = z.enum(CAMPAIGN_MODES);
const statusSchema = z.enum(CAMPAIGN_STATUSES);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function attributionCode() {
  return `ai_${randomBytes(7).toString("base64url")}`;
}

function json(value: unknown) {
  return value as Json;
}

function brandRowText(section: string, content: Json) {
  if (content && typeof content === "object" && !Array.isArray(content) && "text" in content) {
    const text = content.text;
    if (typeof text === "string" && text.trim()) return `${section}: ${text.trim()}`;
  }
  const raw = JSON.stringify(content);
  return raw && raw !== "{}" ? `${section}: ${raw}` : "";
}

async function emitEvent({
  ownerId,
  campaignId,
  eventType,
  entityType,
  entityId,
  payload,
}: {
  ownerId: string;
  campaignId: string | null;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload?: unknown;
}) {
  const { supabase } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const { error } = await marketing.from("marketing_events").insert({
    owner_id: ownerId,
    campaign_id: campaignId,
    event_type: eventType,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    payload: json(payload ?? {}),
  });
  if (error) throw new Error(error.message);
}

export async function createCampaign(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const releaseId = uuid.parse(value(form, "release_id"));
  const objective = objectiveSchema.parse(value(form, "objective") || "Streams");
  const mode = modeSchema.parse(value(form, "mode") || "assisted");
  const { data: release, error: releaseError } = await supabase
    .from("releases")
    .select("id,title,release_date")
    .eq("id", releaseId)
    .eq("owner_id", user.id)
    .single();
  if (releaseError) throw new Error(releaseError.message);

  const kpis = OBJECTIVE_KPIS[objective];
  const window = campaignWindow(release.release_date);
  const { data: campaign, error } = await marketing
    .from("campaigns")
    .insert({
      owner_id: user.id,
      release_id: release.id,
      name: value(form, "name") || `${release.title} campaign`,
      status: "draft",
      mode,
      objective,
      primary_kpi: kpis.primary,
      secondary_kpis: kpis.secondary,
      release_anchor_date: release.release_date,
      start_date: window.startDate,
      end_date: window.endDate,
      strategy: json({}),
      audience_segments: json([]),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const phases = campaignPhasePlan(release.release_date).map((phase) => ({
    ...phase,
    owner_id: user.id,
    campaign_id: campaign.id,
  }));
  const { error: phaseError } = await marketing.from("campaign_phases").insert(phases);
  if (phaseError) throw new Error(phaseError.message);

  await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: campaign.id,
    event_type: "campaign.created",
    entity_type: "campaign",
    entity_id: campaign.id,
    payload: json({ objective, mode, releaseId }),
  });

  revalidatePath("/studio/campaigns");
  redirect(`/studio/campaigns/${campaign.id}`);
}

export async function generateCampaignStrategy(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const force = value(form, "force") === "1";
  const { data: campaign, error: campaignError } = await marketing
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("owner_id", user.id)
    .single();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign.release_id) throw new Error("This campaign must be linked to a release before it can be planned.");

  const currentStrategy = campaign.strategy && typeof campaign.strategy === "object" && !Array.isArray(campaign.strategy)
    ? campaign.strategy as Record<string, Json | undefined>
    : {};
  if (currentStrategy.planVersion && !force) {
    throw new Error("This campaign already has a generated strategy. Use Regenerate draft plan to replace unfinished planner work.");
  }

  const [releaseResult, brandResult, legacyLearningResult, learningResult, contentResult, metricResult] = await Promise.all([
    supabase
      .from("releases")
      .select("id,title,release_type,release_date,story,core_emotion,audience,primary_hook,visual_direction,genre,subgenre,release_identity,smart_link_url,spotify_url,soundcloud_url")
      .eq("id", campaign.release_id)
      .eq("owner_id", user.id)
      .single(),
    supabase.from("brand_settings").select("section,content").eq("owner_id", user.id),
    supabase.from("release_learnings").select("learning").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(20),
    marketing.from("marketing_learnings").select("finding").eq("owner_id", user.id).eq("status", "approved").order("created_at", { ascending: false }).limit(30),
    marketing.from("content_items").select("*").eq("owner_id", user.id),
    marketing.from("metric_snapshots").select("*").eq("owner_id", user.id),
  ]);
  if (releaseResult.error) throw new Error(releaseResult.error.message);
  if (brandResult.error) throw new Error(brandResult.error.message);
  if (legacyLearningResult.error) throw new Error(legacyLearningResult.error.message);
  if (learningResult.error) throw new Error(learningResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (metricResult.error) throw new Error(metricResult.error.message);

  const allMetrics = metricResult.data ?? [];
  const performanceSummary = (contentResult.data ?? [])
    .map((item) => {
      const rows = allMetrics.filter((metric) => metric.content_item_id === item.id);
      const aggregated = aggregateMetrics(rows as unknown as Record<string, unknown>[]);
      const score = objectivePerformanceScore(item.goal, aggregated);
      const primary = primarySignalValue(item.goal, aggregated);
      return {
        title: item.title,
        platform: item.platform,
        format: item.format,
        goal: item.goal,
        score,
        signal: item.goal === "Reach" ? `${Math.round(primary)} reach` : formatRate(primary),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const brandContext = (brandResult.data ?? [])
    .map((row) => brandRowText(row.section, row.content))
    .filter(Boolean);
  const approvedLearnings = [
    ...(learningResult.data ?? []).map((row) => row.finding),
    ...(legacyLearningResult.data ?? []).map((row) => row.learning),
  ].filter(Boolean).slice(0, 30);

  const context: CampaignPlanningContext = {
    release: releaseResult.data,
    objective: objectiveSchema.parse(campaign.objective),
    brandContext,
    approvedLearnings,
    performanceSummary,
  };
  const { plan, generation } = await planCampaign(context);

  if (force) {
    const { data: draftItems, error: draftLookupError } = await marketing
      .from("content_items")
      .select("id")
      .eq("campaign_id", campaignId)
      .in("source", ["planner", "ai"])
      .in("status", ["Idea", "Draft", "In Production", "Ready"]);
    if (draftLookupError) throw new Error(draftLookupError.message);
    if (draftItems?.length) {
      const { error: deleteContentError } = await marketing
        .from("content_items")
        .delete()
        .in("id", draftItems.map((item) => item.id));
      if (deleteContentError) throw new Error(deleteContentError.message);
    }
    const { error: deleteExperimentError } = await marketing
      .from("campaign_experiments")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("status", "planned");
    if (deleteExperimentError) throw new Error(deleteExperimentError.message);
  }

  const { data: generationRun, error: generationError } = await marketing
    .from("generation_runs")
    .insert({
      owner_id: user.id,
      campaign_id: campaignId,
      release_id: campaign.release_id,
      purpose: "campaign_plan",
      provider: generation.provider,
      model: generation.model,
      prompt_version: "marketing-v1",
      input_context: json(context),
      output: json(plan),
      status: "completed",
      provider_request_id: generation.requestId,
    })
    .select("id")
    .single();
  if (generationError) throw new Error(generationError.message);

  const kpis = OBJECTIVE_KPIS[objectiveSchema.parse(campaign.objective)];
  const { error: updateCampaignError } = await marketing
    .from("campaigns")
    .update({
      status: campaign.status === "active" ? "active" : "planned",
      primary_kpi: kpis.primary,
      secondary_kpis: kpis.secondary,
      audience_segments: json(plan.audienceSegments),
      strategy: json({
        planVersion: "marketing-v1",
        generatedAt: new Date().toISOString(),
        provider: generation.provider,
        model: generation.model,
        strategySummary: plan.strategySummary,
        contentPillars: plan.contentPillars,
        learningsApplied: plan.learningsApplied,
      }),
    })
    .eq("id", campaignId);
  if (updateCampaignError) throw new Error(updateCampaignError.message);

  const { data: phases, error: phaseError } = await marketing
    .from("campaign_phases")
    .select("id,code")
    .eq("campaign_id", campaignId);
  if (phaseError) throw new Error(phaseError.message);
  const phaseByCode = new Map((phases ?? []).map((phase) => [phase.code, phase.id]));

  const experimentRows = plan.experiments.map((experiment) => ({
    owner_id: user.id,
    campaign_id: campaignId,
    phase_id: phaseByCode.get(experiment.phaseCode) ?? null,
    title: experiment.title,
    hypothesis: experiment.hypothesis,
    goal: experiment.goal,
    primary_metric: experiment.primaryMetric,
    status: "planned" as const,
  }));
  const { data: experiments, error: experimentError } = await marketing
    .from("campaign_experiments")
    .insert(experimentRows)
    .select("id,title");
  if (experimentError) throw new Error(experimentError.message);
  const experimentByTitle = new Map((experiments ?? []).map((experiment) => [experiment.title, experiment.id]));
  const planExperimentByTitle = new Map(plan.experiments.map((experiment) => [experiment.title, experiment]));
  const destinationUrl = releaseResult.data.smart_link_url || releaseResult.data.spotify_url || releaseResult.data.soundcloud_url;
  const source = generation.provider === "openai" ? "ai" : "planner";

  for (const moment of plan.contentMoments) {
    const experimentId = moment.experimentTitle ? experimentByTitle.get(moment.experimentTitle) ?? null : null;
    const experimentPlan = moment.experimentTitle ? planExperimentByTitle.get(moment.experimentTitle) : undefined;
    const firstVariant = experimentPlan?.variants[0];
    const scheduledAt = releaseRelativeTimestamp(releaseResult.data.release_date, moment.relativeDay);
    const { data: contentItem, error: contentError } = await marketing
      .from("content_items")
      .insert({
        owner_id: user.id,
        release_id: releaseResult.data.id,
        campaign_id: campaignId,
        phase_id: phaseByCode.get(moment.phaseCode) ?? null,
        experiment_id: experimentId,
        title: moment.title,
        platform: moment.platform,
        format: moment.format,
        status: "Draft",
        goal: moment.goal,
        scheduled_at: scheduledAt,
        published_at: null,
        approval_status: "pending",
        source,
        generated_from_run_id: generationRun.id,
        content_angle: moment.contentAngle,
        audience_segment: moment.audienceSegment,
        relative_day: moment.relativeDay,
        schedule_locked: false,
        schedule_local_time: "18:00:00",
        schedule_timezone: "Europe/Berlin",
        hook_text: firstVariant?.hookText ?? moment.contentAngle,
        caption: firstVariant?.caption ?? null,
        cta: firstVariant?.cta ?? null,
        visual_prompt: firstVariant?.visualPrompt ?? releaseResult.data.visual_direction,
        production_notes: firstVariant?.productionNotes ?? `Campaign brief: ${moment.contentAngle}.`,
      })
      .select("id")
      .single();
    if (contentError) throw new Error(contentError.message);

    if (experimentId && experimentPlan) {
      const variantRows = experimentPlan.variants.map((variant, index) => ({
        owner_id: user.id,
        content_item_id: contentItem.id,
        experiment_id: experimentId,
        generation_run_id: generationRun.id,
        label: variant.label,
        hypothesis: experimentPlan.hypothesis,
        hook_text: variant.hookText,
        caption: variant.caption,
        cta: variant.cta,
        visual_prompt: variant.visualPrompt,
        production_notes: variant.productionNotes,
        status: "draft" as const,
        approval_status: "pending" as const,
        is_control: index === 0,
        scheduled_at: scheduledAt,
        attribution_code: destinationUrl ? attributionCode() : null,
      }));
      const { data: variants, error: variantError } = await marketing
        .from("content_variants")
        .insert(variantRows)
        .select("id,label,attribution_code");
      if (variantError) throw new Error(variantError.message);
      if (destinationUrl && variants?.length) {
        const links = variants
          .filter((variant) => variant.attribution_code)
          .map((variant) => ({
            owner_id: user.id,
            campaign_id: campaignId,
            content_item_id: contentItem.id,
            content_variant_id: variant.id,
            code: variant.attribution_code!,
            platform: moment.platform,
            destination_url: destinationUrl,
            label: `${moment.title} / ${variant.label}`,
          }));
        const { error: linkError } = await marketing.from("attribution_links").insert(links);
        if (linkError) throw new Error(linkError.message);
      }
    } else if (destinationUrl) {
      const { error: linkError } = await marketing.from("attribution_links").insert({
        owner_id: user.id,
        campaign_id: campaignId,
        content_item_id: contentItem.id,
        content_variant_id: null,
        code: attributionCode(),
        platform: moment.platform,
        destination_url: destinationUrl,
        label: moment.title,
      });
      if (linkError) throw new Error(linkError.message);
    }
  }

  const { error: eventError } = await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: campaignId,
    event_type: "campaign.plan_generated",
    entity_type: "campaign",
    entity_id: campaignId,
    payload: json({ generationRunId: generationRun.id, provider: generation.provider, model: generation.model }),
  });
  if (eventError) throw new Error(eventError.message);

  revalidatePath(`/studio/campaigns/${campaignId}`);
  revalidatePath("/studio/campaigns");
  revalidatePath("/studio/content");
}

export async function updateCampaignMode(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const mode = modeSchema.parse(value(form, "mode"));
  const { error } = await marketing.from("campaigns").update({ mode }).eq("id", campaignId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  await emitEvent({ ownerId: user.id, campaignId, eventType: "campaign.mode_changed", entityType: "campaign", entityId: campaignId, payload: { mode } });
  revalidatePath(`/studio/campaigns/${campaignId}`);
}

export async function updateCampaignStatus(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const campaignId = uuid.parse(value(form, "campaign_id"));
  const status = statusSchema.parse(value(form, "status"));
  const { error } = await marketing.from("campaigns").update({ status }).eq("id", campaignId).eq("owner_id", user.id);
  if (error) throw new Error(error.message);
  await emitEvent({ ownerId: user.id, campaignId, eventType: "campaign.status_changed", entityType: "campaign", entityId: campaignId, payload: { status } });
  revalidatePath(`/studio/campaigns/${campaignId}`);
  revalidatePath("/studio/campaigns");
}

export async function approveContentVariant(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const variantId = uuid.parse(value(form, "variant_id"));
  const { data: variant, error: lookupError } = await marketing
    .from("content_variants")
    .select("id,content_item_id,experiment_id")
    .eq("id", variantId)
    .eq("owner_id", user.id)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  const { error } = await marketing
    .from("content_variants")
    .update({ approval_status: "approved", status: "approved" })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  const { data: item } = await marketing.from("content_items").select("campaign_id").eq("id", variant.content_item_id).single();
  await emitEvent({ ownerId: user.id, campaignId: item?.campaign_id ?? null, eventType: "content.variant_approved", entityType: "content_variant", entityId: variantId, payload: { experimentId: variant.experiment_id } });
  revalidatePath("/studio/campaigns");
  if (item?.campaign_id) revalidatePath(`/studio/campaigns/${item.campaign_id}`);
}

export async function rejectContentVariant(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const variantId = uuid.parse(value(form, "variant_id"));
  const { data: variant, error: lookupError } = await marketing
    .from("content_variants")
    .select("content_item_id")
    .eq("id", variantId)
    .eq("owner_id", user.id)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  const { error } = await marketing
    .from("content_variants")
    .update({ approval_status: "rejected", status: "rejected" })
    .eq("id", variantId);
  if (error) throw new Error(error.message);
  const { data: item } = await marketing.from("content_items").select("campaign_id").eq("id", variant.content_item_id).single();
  if (item?.campaign_id) revalidatePath(`/studio/campaigns/${item.campaign_id}`);
}

function adapterForPlatform(platform: string) {
  return `manual:${platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

export async function queueVariantPublication(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const variantId = uuid.parse(value(form, "variant_id"));
  const { data: variant, error: variantError } = await marketing
    .from("content_variants")
    .select("*")
    .eq("id", variantId)
    .eq("owner_id", user.id)
    .single();
  if (variantError) throw new Error(variantError.message);
  if (variant.approval_status !== "approved") throw new Error("Approve this creative variant before queueing publication.");
  const { data: item, error: itemError } = await marketing
    .from("content_items")
    .select("*")
    .eq("id", variant.content_item_id)
    .single();
  if (itemError) throw new Error(itemError.message);
  if (!item.campaign_id) throw new Error("This content item is not linked to a campaign.");

  const idempotencyKey = `publish:${variant.id}:${variant.scheduled_at ?? item.scheduled_at ?? "now"}`;
  const scheduledAt = variant.scheduled_at ?? item.scheduled_at ?? new Date().toISOString();
  const { error } = await marketing.from("publication_jobs").insert({
    owner_id: user.id,
    campaign_id: item.campaign_id,
    content_item_id: item.id,
    content_variant_id: variant.id,
    platform: item.platform,
    adapter: adapterForPlatform(item.platform),
    status: new Date(scheduledAt).getTime() > Date.now() ? "scheduled" : "approved",
    requires_approval: true,
    approval_status: "approved",
    scheduled_at: scheduledAt,
    request_payload: json({
      hookText: variant.hook_text,
      caption: variant.caption,
      cta: variant.cta,
      assetUrl: variant.asset_url ?? item.asset_url,
      attributionCode: variant.attribution_code,
    }),
    idempotency_key: idempotencyKey,
  });
  if (error && !error.message.toLowerCase().includes("duplicate")) throw new Error(error.message);

  await emitEvent({
    ownerId: user.id,
    campaignId: item.campaign_id,
    eventType: "publication.queued",
    entityType: "content_variant",
    entityId: variant.id,
    payload: { platform: item.platform, scheduledAt },
  });
  revalidatePath(`/studio/campaigns/${item.campaign_id}`);
}

function variantMetricSummary(
  variant: ContentVariant,
  metrics: Array<Record<string, unknown>>,
  experiment: CampaignExperiment,
) {
  const rows = metrics.filter((metric) => metric.content_variant_id === variant.id);
  const aggregate = aggregateMetrics(rows);
  const sample = Math.max(aggregate.reach ?? 0, aggregate.views ?? 0);
  const signal = primarySignalValue(experiment.goal, aggregate);
  return { variant, aggregate, sample, signal };
}

export async function evaluateExperiment(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const experimentId = uuid.parse(value(form, "experiment_id"));
  const { data: experiment, error: experimentError } = await marketing
    .from("campaign_experiments")
    .select("*")
    .eq("id", experimentId)
    .eq("owner_id", user.id)
    .single();
  if (experimentError) throw new Error(experimentError.message);
  const [variantsResult, metricsResult, campaignResult] = await Promise.all([
    marketing.from("content_variants").select("*").eq("experiment_id", experimentId).eq("owner_id", user.id),
    marketing.from("metric_snapshots").select("*").eq("experiment_id", experimentId).eq("owner_id", user.id),
    marketing.from("campaigns").select("mode,release_id").eq("id", experiment.campaign_id).single(),
  ]);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (metricsResult.error) throw new Error(metricsResult.error.message);
  if (campaignResult.error) throw new Error(campaignResult.error.message);

  const summaries = (variantsResult.data ?? [])
    .map((variant) => variantMetricSummary(variant, metricsResult.data as unknown as Array<Record<string, unknown>>, experiment))
    .filter((summary) => summary.sample >= experiment.minimum_sample)
    .sort((a, b) => b.signal - a.signal);

  if (summaries.length < 2) {
    const summary = `Waiting for at least two variants to reach ${experiment.minimum_sample.toLocaleString()} qualified views/reach.`;
    const { error } = await marketing
      .from("campaign_experiments")
      .update({ status: "evaluating", result_summary: summary })
      .eq("id", experimentId);
    if (error) throw new Error(error.message);
    revalidatePath(`/studio/campaigns/${experiment.campaign_id}`);
    return;
  }

  const [best, second] = summaries;
  const lift = second.signal > 0 ? (best.signal - second.signal) / second.signal : best.signal > 0 ? 1 : 0;
  const hasWinner = lift >= Number(experiment.minimum_lift);
  const resultSummary = hasWinner
    ? `Variant ${best.variant.label} leads by ${(lift * 100).toFixed(1)}% on ${experiment.primary_metric} after ${best.sample.toLocaleString()} qualified observations.`
    : `No reliable winner yet. The top two variants are within ${(Math.abs(lift) * 100).toFixed(1)}% on ${experiment.primary_metric}.`;
  const { error: updateError } = await marketing
    .from("campaign_experiments")
    .update({
      status: hasWinner ? "winner_found" : "inconclusive",
      winner_variant_id: hasWinner ? best.variant.id : null,
      result_summary: resultSummary,
    })
    .eq("id", experimentId);
  if (updateError) throw new Error(updateError.message);

  if (hasWinner) {
    const evidence = {
      metric: experiment.primary_metric,
      lift,
      winner: {
        variantId: best.variant.id,
        label: best.variant.label,
        sample: best.sample,
        signal: best.signal,
        hookText: best.variant.hook_text,
      },
      runnerUp: {
        variantId: second.variant.id,
        label: second.variant.label,
        sample: second.sample,
        signal: second.signal,
      },
    };
    const { error: learningError } = await marketing.from("marketing_learnings").insert({
      owner_id: user.id,
      campaign_id: experiment.campaign_id,
      release_id: campaignResult.data.release_id,
      experiment_id: experiment.id,
      scope: "experiment",
      finding: `${experiment.title}: ${best.variant.label} is the current winning framing. ${best.variant.hook_text ?? ""}`.trim(),
      evidence: json(evidence),
      confidence: Math.min(0.95, 0.55 + Math.min(lift, 1) * 0.3 + Math.min(best.sample / 5000, 1) * 0.1),
      status: "proposed",
      applies_to: json({ goal: experiment.goal }),
      source: "experiment",
    });
    if (learningError) throw new Error(learningError.message);

    const requiresApproval = campaignResult.data.mode !== "autopilot";
    const { error: jobError } = await marketing.from("automation_jobs").insert({
      owner_id: user.id,
      campaign_id: experiment.campaign_id,
      job_type: "generate_winner_derivatives",
      payload: json({ experimentId, winnerVariantId: best.variant.id }),
      status: requiresApproval ? "awaiting_approval" : "queued",
      requires_approval: requiresApproval,
      approval_status: requiresApproval ? "pending" : "not_required",
      idempotency_key: `winner-derivatives:${experimentId}:${best.variant.id}`,
    });
    if (jobError && !jobError.message.toLowerCase().includes("duplicate")) throw new Error(jobError.message);
  }

  await marketing.from("marketing_events").insert({
    owner_id: user.id,
    campaign_id: experiment.campaign_id,
    event_type: "experiment.evaluated",
    entity_type: "campaign_experiment",
    entity_id: experiment.id,
    payload: json({ hasWinner, resultSummary }),
  });
  revalidatePath(`/studio/campaigns/${experiment.campaign_id}`);
  revalidatePath("/studio/analytics");
}

export async function setLearningStatus(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const learningId = uuid.parse(value(form, "learning_id"));
  const status = z.enum(["approved", "rejected"]).parse(value(form, "status"));
  const { data: learning, error: lookupError } = await marketing
    .from("marketing_learnings")
    .select("campaign_id")
    .eq("id", learningId)
    .eq("owner_id", user.id)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  const { error } = await marketing
    .from("marketing_learnings")
    .update({ status, approved_at: status === "approved" ? new Date().toISOString() : null })
    .eq("id", learningId);
  if (error) throw new Error(error.message);
  if (learning.campaign_id) revalidatePath(`/studio/campaigns/${learning.campaign_id}`);
  revalidatePath("/studio/analytics");
}

export async function approveAutomationJob(form: FormData) {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const jobId = uuid.parse(value(form, "job_id"));
  const { data: job, error: lookupError } = await marketing
    .from("automation_jobs")
    .select("campaign_id")
    .eq("id", jobId)
    .eq("owner_id", user.id)
    .single();
  if (lookupError) throw new Error(lookupError.message);
  const { error } = await marketing
    .from("automation_jobs")
    .update({ status: "queued", approval_status: "approved" })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  if (job.campaign_id) revalidatePath(`/studio/campaigns/${job.campaign_id}`);
}
