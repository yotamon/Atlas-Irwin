"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadArtistAutonomyContract, resolveAndAuditAutonomyDecision } from "@/lib/autonomy/server";
import { asMarketingClient } from "@/lib/marketing/db";
import { asPaidGrowthClient, createPaidGrowthServiceClient } from "@/lib/paid-growth/db";
import { evaluatePaidGrowthExperiment, paidGrowthEvidenceStrength } from "@/lib/paid-growth/domain";
import { getPaidGrowthProvider } from "@/lib/paid-growth/provider";
import { smartLinkSourceUrl } from "@/lib/smart-links/source-url";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import type { Json } from "@/types/database";
import type { PaidGrowthExperiment, PaidGrowthObservation, PaidGrowthSuccessMetric } from "@/types/paid-growth-database";

const PLATFORMS = new Set(["instagram", "facebook", "tiktok", "youtube", "other"]);
const OBJECTIVES = new Set(["discovery", "traffic", "pre_save", "streams"]);
const SUCCESS_METRICS = new Set<PaidGrowthSuccessMetric>(["landing_views", "outbound_clicks", "pre_save_completions", "cost_per_outbound_click", "cost_per_pre_save_completion"]);

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function json(value: unknown): Json {
  return value as Json;
}

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dollarsToCents(raw: string, label: string, optional = false) {
  if (!raw && optional) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be greater than zero.`);
  return Math.round(amount * 100);
}

function positiveInteger(raw: string, label: string, fallback?: number) {
  if (!raw && fallback != null) return fallback;
  const number = Number(raw);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${label} must be a positive whole number.`);
  return number;
}

function countryCodes(raw: string) {
  const countries = [...new Set(raw.split(/[\s,;]+/).map((entry) => entry.trim().toUpperCase()).filter(Boolean))];
  const invalid = countries.find((entry) => !/^[A-Z]{2}$/.test(entry));
  if (invalid) throw new Error(`Country '${invalid}' must use a two-letter ISO code.`);
  return countries;
}

function refreshPaidGrowth(experimentId?: string) {
  revalidatePath("/studio/growth");
  revalidatePath("/studio/growth/paid");
  revalidatePath("/studio/needs-you");
  revalidatePath("/studio");
  if (experimentId) revalidatePath(`/studio/growth/paid?experiment=${experimentId}`);
}

async function artistContext() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  return { supabase, user, artist, paid: asPaidGrowthClient(supabase), marketing: asMarketingClient(supabase) };
}

async function loadOwnedExperiment(id: string) {
  if (!id) throw new Error("Paid experiment is required.");
  const context = await artistContext();
  const { data, error } = await context.paid.from("paid_growth_experiments").select("*")
    .eq("id", id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Paid experiment not found for the active artist.");
  return { ...context, experiment: data as PaidGrowthExperiment };
}

async function auditEvent(experiment: PaidGrowthExperiment, eventType: string, actorType: "artist" | "system" | "provider", payload: Json) {
  const service = createPaidGrowthServiceClient();
  const { error } = await service.from("paid_growth_events").insert({
    experiment_id: experiment.id,
    owner_id: experiment.owner_id,
    artist_id: experiment.artist_id,
    event_type: eventType,
    actor_type: actorType,
    payload,
  });
  if (error) throw new Error(error.message);
}

export async function createPaidGrowthExperiment(form: FormData) {
  const { supabase, user, artist, paid, marketing } = await artistContext();
  const releaseId = value(form, "release_id");
  const contentItemId = value(form, "content_item_id");
  const momentId = value(form, "moment_id") || null;
  if (!releaseId || !contentItemId) throw new Error("Choose a release and an approved creative before creating a paid test.");

  const [releaseResult, creativeResult, smartLinkResult, momentResult, learningsResult] = await Promise.all([
    paid.from("releases").select("id,title").eq("id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    marketing.from("content_items").select("id,title,release_id,campaign_id,asset_url,status").eq("id", contentItemId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    paid.from("smart_links").select("id,release_id,is_active").eq("release_id", releaseId).eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("is_active", true).maybeSingle(),
    momentId ? paid.from("moments").select("id,label,state,release_id").eq("id", momentId).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    marketing.from("marketing_learnings").select("id,release_id,finding,evidence,status,source").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "approved").order("created_at", { ascending: false }).limit(12),
  ]);
  for (const result of [releaseResult, creativeResult, smartLinkResult, momentResult, learningsResult]) if (result.error) throw new Error(result.error.message);
  if (!releaseResult.data) throw new Error("Release not found for the active artist.");
  const creative = creativeResult.data;
  if (!creative || creative.release_id !== releaseId) throw new Error("Creative must belong to the selected release.");
  if (!creative.asset_url) throw new Error("Use an approved production item with a finished asset before spending on distribution.");
  const smartLink = smartLinkResult.data;
  if (!smartLink) throw new Error("This release needs an active Ensemblis Smart Link before paid traffic can be attributed safely.");
  if (momentId && (!momentResult.data || momentResult.data.release_id !== releaseId || momentResult.data.state !== "approved")) {
    throw new Error("Paid tests may reference only an approved Moment from the same release.");
  }

  const title = value(form, "title");
  const hypothesis = value(form, "hypothesis");
  const rationale = value(form, "evidence_note");
  if (title.length < 3) throw new Error("Give the experiment a short title.");
  if (hypothesis.length < 10) throw new Error("State a testable hypothesis before allocating budget.");
  if (rationale.length < 10) throw new Error("Explain why this experiment is worth spending money on.");

  const platform = value(form, "platform").toLowerCase();
  const provider = value(form, "provider").toLowerCase() || "meta";
  const objective = value(form, "objective").toLowerCase();
  if (!PLATFORMS.has(platform)) throw new Error("Unsupported paid platform.");
  if (!OBJECTIVES.has(objective)) throw new Error("Unsupported paid objective.");
  const successMetric = value(form, "success_metric") as PaidGrowthSuccessMetric;
  if (!SUCCESS_METRICS.has(successMetric)) throw new Error("Choose a supported success metric.");

  const budgetCeilingCents = dollarsToCents(value(form, "budget_ceiling_usd"), "Hard budget ceiling")!;
  const dailyBudgetCents = dollarsToCents(value(form, "daily_budget_usd"), "Daily budget", true);
  if (dailyBudgetCents != null && dailyBudgetCents > budgetCeilingCents) throw new Error("Daily budget cannot exceed the experiment hard ceiling.");
  const minimumSample = Math.max(10, positiveInteger(value(form, "minimum_sample"), "Minimum sample", 100));
  const thresholdInput = Number(value(form, "success_threshold"));
  if (!Number.isFinite(thresholdInput) || thresholdInput <= 0) throw new Error("Success threshold must be greater than zero.");
  const successThreshold = successMetric.startsWith("cost_per_") ? Math.round(thresholdInput * 100) : thresholdInput;
  const maxSpendWithoutResultCents = dollarsToCents(value(form, "max_spend_without_result_usd"), "No-result stop loss", true)
    ?? Math.max(100, Math.round(budgetCeilingCents * 0.5));
  const maxCostPerResultCents = dollarsToCents(value(form, "max_cost_per_result_usd"), "Cost stop loss", true);
  const geoCountries = countryCodes(value(form, "geo_countries"));
  const audienceDescription = value(form, "audience_description") || "Broad audience aligned with the release";

  const learningEvidence = (learningsResult.data ?? [])
    .filter((learning) => !learning.release_id || learning.release_id === releaseId)
    .slice(0, 3)
    .map((learning) => ({ kind: "learning", verified: true, learningId: learning.id, finding: learning.finding, source: learning.source }));
  const evidence = [
    ...learningEvidence,
    { kind: "artist_rationale", verified: false, detail: rationale },
    ...(momentResult.data ? [{ kind: "moment", verified: false, momentId: momentResult.data.id, label: momentResult.data.label }] : []),
    { kind: "creative", verified: false, contentItemId: creative.id, title: creative.title },
  ];
  const evidenceStrength = paidGrowthEvidenceStrength(json(evidence));
  const sourceCode = `pg_${randomUUID().replaceAll("-", "").slice(0, 28)}`;
  const { data: source, error: sourceError } = await paid.from("smart_link_sources").insert({
    smart_link_id: smartLink.id,
    owner_id: user.id,
    artist_id: artist.artistId,
    campaign_id: creative.campaign_id,
    content_item_id: creative.id,
    moment_id: momentId,
    code: sourceCode,
    label: `Paid test · ${title}`,
  }).select("id,code").single();
  if (sourceError) throw new Error(sourceError.message);

  const idempotencyKey = `paid:${artist.artistId}:${randomUUID()}`;
  const { data: experiment, error: experimentError } = await paid.from("paid_growth_experiments").insert({
    owner_id: user.id,
    artist_id: artist.artistId,
    release_id: releaseId,
    campaign_id: creative.campaign_id,
    moment_id: momentId,
    content_item_id: creative.id,
    smart_link_id: smartLink.id,
    smart_link_source_id: source.id,
    title,
    hypothesis,
    evidence: json(evidence),
    evidence_strength: evidenceStrength,
    provider,
    platform,
    objective,
    audience: json({ description: audienceDescription }),
    geo_countries: geoCountries,
    currency: "USD",
    budget_ceiling_cents: budgetCeilingCents,
    daily_budget_cents: dailyBudgetCents,
    spent_cents: 0,
    minimum_sample: minimumSample,
    success_metric: successMetric,
    success_threshold: successThreshold,
    stop_conditions: json({ maxSpendWithoutResultCents, maxCostPerResultCents, stopAtBudgetCeiling: true, stopOnSuccess: true }),
    state: "ready_for_approval",
    approval_status: "pending",
    provider_metadata: {},
    verified_outcome: false,
    idempotency_key: idempotencyKey,
  }).select("*").single();
  if (experimentError) {
    await paid.from("smart_link_sources").delete().eq("id", source.id).eq("owner_id", user.id).eq("artist_id", artist.artistId);
    throw new Error(experimentError.message);
  }

  await auditEvent(experiment as PaidGrowthExperiment, "paid_growth.experiment_prepared", "system", json({ evidenceStrength, budgetCeilingCents, minimumSample, successMetric, sourceCode }));
  refreshPaidGrowth(experiment.id);
  redirect(`/studio/growth/paid?experiment=${experiment.id}&notice=${encodeURIComponent("Paid experiment prepared for approval.")}`);
}

export async function approvePaidGrowthExperiment(form: FormData) {
  if (value(form, "confirm_approval") !== "on") throw new Error("Explicitly confirm the paid experiment before approval.");
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  if (experiment.state !== "ready_for_approval" || experiment.approval_status !== "pending") throw new Error("This experiment is not awaiting approval.");

  const contract = await loadArtistAutonomyContract({ db: context.supabase, ownerId: context.user.id, artistId: context.artist.artistId, domain: "paid_growth" });
  const { data: spendRows, error: spendError } = await context.paid.from("paid_growth_experiments").select("spent_cents")
    .eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).in("state", ["approved", "launching", "running", "paused", "evaluating"]);
  if (spendError) throw new Error(spendError.message);
  const currentSpendUsd = (spendRows ?? []).reduce((sum, row) => sum + row.spent_cents, 0) / 100;
  const autonomy = await resolveAndAuditAutonomyDecision({
    ownerId: context.user.id,
    artistId: context.artist.artistId,
    domain: "paid_growth",
    contract,
    effect: {
      action: `Launch paid experiment ${experiment.id}`,
      external: true,
      paid: true,
      estimatedCostUsd: experiment.budget_ceiling_cents / 100,
      currentContractSpendUsd: currentSpendUsd,
      provider: experiment.provider,
      platform: experiment.platform,
    },
    executionId: `paid-growth:${experiment.id}`,
  });

  const providerMetadata = { ...object(experiment.provider_metadata), autonomy: { behavior: autonomy.behavior, reason: autonomy.reason, contractId: autonomy.contractId, evaluatedAt: new Date().toISOString() } };
  const now = new Date().toISOString();
  const { error } = await context.paid.from("paid_growth_experiments").update({
    approval_status: "approved",
    approved_at: now,
    approved_by: context.user.id,
    state: "approved",
    provider_metadata: json(providerMetadata),
  }).eq("id", experiment.id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId);
  if (error) throw new Error(error.message);
  await auditEvent({ ...experiment, approval_status: "approved", approved_at: now } as PaidGrowthExperiment, "paid_growth.experiment_approved", "artist", json({ autonomyBehavior: autonomy.behavior, autonomyReason: autonomy.reason }));
  refreshPaidGrowth(experiment.id);
  redirect(`/studio/growth/paid?experiment=${experiment.id}&notice=${encodeURIComponent("Paid experiment approved. External launch remains bounded by the provider connection and hard budget.")}`);
}

export async function launchPaidGrowthExperiment(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  if (experiment.approval_status !== "approved" || experiment.state !== "approved") throw new Error("Approve this paid experiment before launch.");
  const provider = getPaidGrowthProvider(experiment.provider);
  if (!provider.configured) throw new Error(provider.reasonUnavailable ?? "Paid-media provider is not connected.");
  if (!experiment.smart_link_source_id) throw new Error("Paid experiment attribution source is missing.");
  const destinationUrl = await smartLinkSourceUrl(experiment.smart_link_source_id, context.user.id, context.artist.artistId);
  if (!destinationUrl) throw new Error("Publish the artist site before sending paid traffic to this Smart Link.");

  const [sourceResult, creativeResult] = await Promise.all([
    context.paid.from("smart_link_sources").select("id,code").eq("id", experiment.smart_link_source_id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).maybeSingle(),
    experiment.content_item_id ? context.paid.from("content_items").select("id,title,asset_url").eq("id", experiment.content_item_id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (sourceResult.error) throw new Error(sourceResult.error.message);
  if (creativeResult.error) throw new Error(creativeResult.error.message);
  if (!sourceResult.data) throw new Error("Paid attribution source is unavailable.");
  if (!creativeResult.data?.asset_url) throw new Error("Paid launch requires the approved creative asset.");

  const service = createPaidGrowthServiceClient();
  const operationKey = `launch:${experiment.id}`;
  const { data: existing, error: existingError } = await service.from("paid_growth_operations").select("*").eq("provider", experiment.provider).eq("operation_key", operationKey).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.state === "completed" && existing.provider_resource_id) {
    await service.from("paid_growth_experiments").update({ state: "running", provider_experiment_id: existing.provider_resource_id, starts_at: experiment.starts_at ?? new Date().toISOString() }).eq("id", experiment.id);
    refreshPaidGrowth(experiment.id);
    return;
  }
  if (existing && ["started", "ambiguous"].includes(existing.state)) throw new Error("A previous paid launch has an uncertain provider result. Reconcile it before retrying.");

  const { error: operationError } = await service.from("paid_growth_operations").insert({
    experiment_id: experiment.id,
    owner_id: experiment.owner_id,
    artist_id: experiment.artist_id,
    provider: experiment.provider,
    operation_type: "launch",
    operation_key: operationKey,
    state: "started",
    request_snapshot: json({ platform: experiment.platform, budgetCeilingCents: experiment.budget_ceiling_cents, sourceCode: sourceResult.data.code }),
  });
  if (operationError) throw new Error(operationError.message);

  try {
    const launched = await provider.launch({
      experimentId: experiment.id,
      provider: experiment.provider,
      platform: experiment.platform,
      title: experiment.title,
      objective: experiment.objective,
      hypothesis: experiment.hypothesis,
      destinationUrl,
      sourceCode: sourceResult.data.code,
      budgetCeilingUsd: experiment.budget_ceiling_cents / 100,
      dailyBudgetUsd: experiment.daily_budget_cents == null ? null : experiment.daily_budget_cents / 100,
      geoCountries: experiment.geo_countries,
      audience: experiment.audience,
      creative: { contentItemId: creativeResult.data.id, assetUrl: creativeResult.data.asset_url, title: creativeResult.data.title },
    });
    const now = new Date().toISOString();
    const operationUpdate = await service.from("paid_growth_operations").update({ state: "completed", result_snapshot: launched.raw, provider_resource_id: launched.providerExperimentId, completed_at: now }).eq("provider", experiment.provider).eq("operation_key", operationKey);
    if (operationUpdate.error) throw new Error(operationUpdate.error.message);
    const experimentUpdate = await service.from("paid_growth_experiments").update({ state: "running", provider_experiment_id: launched.providerExperimentId, starts_at: now }).eq("id", experiment.id);
    if (experimentUpdate.error) throw new Error(experimentUpdate.error.message);
    await auditEvent(experiment, "paid_growth.launched", "provider", json({ providerExperimentId: launched.providerExperimentId, destinationUrl }));
  } catch (error) {
    await service.from("paid_growth_operations").update({ state: "ambiguous", error: error instanceof Error ? error.message : "Paid launch failed with unknown provider result" }).eq("provider", experiment.provider).eq("operation_key", operationKey);
    throw error;
  }
  refreshPaidGrowth(experiment.id);
}

export async function recordPaidGrowthProviderSnapshot(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  const spendCents = dollarsToCents(value(form, "spend_usd") || "0.01", "Observed spend") ?? 0;
  if (spendCents > experiment.budget_ceiling_cents) throw new Error("Reported spend exceeds this experiment's approved hard ceiling. Reconcile the provider before continuing.");
  const impressions = Math.max(0, Number(value(form, "impressions")) || 0);
  const clicks = Math.max(0, Number(value(form, "provider_clicks")) || 0);
  const observedAt = new Date().toISOString();
  const { error } = await context.paid.rpc("record_paid_growth_observation", {
    p_experiment_id: experiment.id,
    p_provider_reference: `manual:${randomUUID()}`,
    p_impressions: Math.floor(impressions),
    p_provider_clicks: Math.floor(clicks),
    p_spend_cents: spendCents,
    p_landing_views: 0,
    p_outbound_clicks: 0,
    p_pre_save_completions: 0,
    p_verified: false,
    p_verification_reference: null,
    p_provider_snapshot: json({ source: "artist_manual_import", note: value(form, "provider_note") || null }),
    p_first_party_snapshot: {},
    p_observed_at: observedAt,
  });
  if (error) throw new Error(error.message);
  refreshPaidGrowth(experiment.id);
}

export async function syncPaidGrowthFirstPartyEvidence(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  if (!experiment.smart_link_source_id) throw new Error("Paid attribution source is missing.");
  const { data: source, error: sourceError } = await context.paid.from("smart_link_sources").select("id,code").eq("id", experiment.smart_link_source_id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  if (!source) throw new Error("Paid attribution source is unavailable.");
  const start = experiment.starts_at ?? experiment.created_at;
  const { data: events, error: eventsError } = await context.paid.from("smart_link_events").select("id,event_type,verified,verification_reference,occurred_at")
    .eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).eq("smart_link_id", experiment.smart_link_id).eq("source_code", source.code).gte("occurred_at", start).order("occurred_at", { ascending: true });
  if (eventsError) throw new Error(eventsError.message);
  const rows = events ?? [];
  const landingViews = rows.filter((row) => row.event_type === "landing_view").length;
  const outboundClicks = rows.filter((row) => row.event_type === "outbound_click").length;
  const preSaveCompletions = rows.filter((row) => row.event_type === "pre_save_completion" && row.verified).length;
  const { data: latestProvider, error: latestError } = await context.paid.from("paid_growth_observations").select("spend_cents").eq("experiment_id", experiment.id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).order("observed_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const spendCents = latestProvider?.spend_cents ?? experiment.spent_cents;
  const lastAt = rows.at(-1)?.occurred_at ?? start;
  const countMetric = !experiment.success_metric.startsWith("cost_per_");
  const { error } = await context.paid.rpc("record_paid_growth_observation", {
    p_experiment_id: experiment.id,
    p_provider_reference: `first-party:${rows.length}:${lastAt}:${spendCents}`,
    p_impressions: 0,
    p_provider_clicks: 0,
    p_spend_cents: spendCents,
    p_landing_views: landingViews,
    p_outbound_clicks: outboundClicks,
    p_pre_save_completions: preSaveCompletions,
    p_verified: countMetric,
    p_verification_reference: countMetric ? `ensemblis:first-party:${source.code}:${lastAt}` : null,
    p_provider_snapshot: json({ source: "not_verified_by_provider", carriedSpendCents: spendCents }),
    p_first_party_snapshot: json({ sourceCode: source.code, eventCount: rows.length, landingViews, outboundClicks, verifiedPreSaveCompletions: preSaveCompletions, lastEventAt: lastAt }),
    p_observed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await evaluatePaidGrowthExperimentAction(form);
  refreshPaidGrowth(experiment.id);
}

export async function syncPaidGrowthProvider(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  if (!experiment.provider_experiment_id) throw new Error("This experiment has no Ensemblis-managed provider campaign to sync.");
  const provider = getPaidGrowthProvider(experiment.provider);
  if (!provider.configured) throw new Error(provider.reasonUnavailable ?? "Paid provider is not connected.");
  const snapshot = await provider.sync(experiment.provider_experiment_id);
  const service = createPaidGrowthServiceClient();
  const { data: source, error: sourceError } = await service.from("smart_link_sources").select("code").eq("id", experiment.smart_link_source_id ?? "").maybeSingle();
  if (sourceError) throw new Error(sourceError.message);
  let landingViews = 0;
  let outboundClicks = 0;
  let preSaveCompletions = 0;
  if (source?.code) {
    const { data: events, error: eventError } = await service.from("smart_link_events").select("event_type,verified").eq("smart_link_id", experiment.smart_link_id).eq("source_code", source.code).gte("occurred_at", experiment.starts_at ?? experiment.created_at);
    if (eventError) throw new Error(eventError.message);
    landingViews = (events ?? []).filter((row) => row.event_type === "landing_view").length;
    outboundClicks = (events ?? []).filter((row) => row.event_type === "outbound_click").length;
    preSaveCompletions = (events ?? []).filter((row) => row.event_type === "pre_save_completion" && row.verified).length;
  }
  const { error } = await service.rpc("record_paid_growth_observation", {
    p_experiment_id: experiment.id,
    p_provider_reference: snapshot.providerReference,
    p_impressions: snapshot.impressions,
    p_provider_clicks: snapshot.clicks,
    p_spend_cents: snapshot.spendCents,
    p_landing_views: landingViews,
    p_outbound_clicks: outboundClicks,
    p_pre_save_completions: preSaveCompletions,
    p_verified: snapshot.verified,
    p_verification_reference: snapshot.verified ? `${experiment.provider}:${snapshot.providerReference}` : null,
    p_provider_snapshot: snapshot.raw,
    p_first_party_snapshot: json({ landingViews, outboundClicks, verifiedPreSaveCompletions: preSaveCompletions }),
    p_observed_at: snapshot.observedAt,
  });
  if (error) throw new Error(error.message);
  refreshPaidGrowth(experiment.id);
}

export async function evaluatePaidGrowthExperimentAction(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  const { data: observations, error: observationError } = await context.paid.from("paid_growth_observations").select("*").eq("experiment_id", experiment.id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId).order("observed_at", { ascending: false });
  if (observationError) throw new Error(observationError.message);
  const evaluation = evaluatePaidGrowthExperiment(experiment, (observations ?? []) as PaidGrowthObservation[]);
  const providerMetadata = object(experiment.provider_metadata);
  let learningId = typeof providerMetadata.learningId === "string" ? providerMetadata.learningId : null;

  if (evaluation.learningEligible && !learningId) {
    const metricValue = evaluation.metricValue == null ? null : evaluation.metricValue;
    const { data: learning, error: learningError } = await context.marketing.from("marketing_learnings").insert({
      owner_id: context.user.id,
      artist_id: context.artist.artistId,
      campaign_id: experiment.campaign_id,
      release_id: experiment.release_id,
      experiment_id: null,
      scope: "experiment",
      finding: `${experiment.title}: ${evaluation.label}. ${evaluation.detail}`,
      evidence: json({ paidGrowthExperimentId: experiment.id, verified: true, metric: experiment.success_metric, metricValue, sample: evaluation.sample, provider: experiment.provider, platform: experiment.platform }),
      confidence: experiment.evidence_strength === "strong" ? 0.9 : 0.82,
      status: "proposed",
      applies_to: json({ releaseId: experiment.release_id, platform: experiment.platform, objective: experiment.objective }),
      source: "experiment",
      approved_at: null,
    }).select("id").single();
    if (learningError) throw new Error(learningError.message);
    learningId = learning.id;
  }

  const noManagedCampaign = !experiment.provider_experiment_id;
  const terminal = ["success", "stop", "inconclusive"].includes(evaluation.phase);
  const nextState = terminal && noManagedCampaign ? "completed" : experiment.state;
  const { error: updateError } = await context.paid.from("paid_growth_experiments").update({
    state: nextState,
    verified_outcome: evaluation.learningEligible,
    result_summary: `${evaluation.label}. ${evaluation.detail}`,
    provider_metadata: json({ ...providerMetadata, ...(learningId ? { learningId } : {}), lastEvaluation: { phase: evaluation.phase, verified: evaluation.verified, sample: evaluation.sample, evaluatedAt: new Date().toISOString() } }),
  }).eq("id", experiment.id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId);
  if (updateError) throw new Error(updateError.message);
  await auditEvent(experiment, "paid_growth.evaluated", "system", json({ phase: evaluation.phase, shouldStop: evaluation.shouldStop, learningEligible: evaluation.learningEligible, learningId }));
  refreshPaidGrowth(experiment.id);
}

export async function stopPaidGrowthExperiment(form: FormData) {
  const context = await loadOwnedExperiment(value(form, "experiment_id"));
  const experiment = context.experiment;
  const now = new Date().toISOString();
  if (!experiment.provider_experiment_id) {
    const { error } = await context.paid.from("paid_growth_experiments").update({ state: experiment.verified_outcome ? "completed" : "stopped", ends_at: now }).eq("id", experiment.id).eq("owner_id", context.user.id).eq("artist_id", context.artist.artistId);
    if (error) throw new Error(error.message);
    await auditEvent(experiment, "paid_growth.stopped", "artist", json({ externalProviderCampaign: false }));
    refreshPaidGrowth(experiment.id);
    return;
  }
  const provider = getPaidGrowthProvider(experiment.provider);
  if (!provider.configured) throw new Error(`${provider.reasonUnavailable ?? "Paid provider is unavailable"} Ensemblis cannot claim the external campaign is stopped.`);
  const service = createPaidGrowthServiceClient();
  const operationKey = `stop:${experiment.id}:${experiment.provider_experiment_id}`;
  const { error: operationError } = await service.from("paid_growth_operations").insert({ experiment_id: experiment.id, owner_id: experiment.owner_id, artist_id: experiment.artist_id, provider: experiment.provider, operation_type: "stop", operation_key: operationKey, state: "started", request_snapshot: json({ providerExperimentId: experiment.provider_experiment_id }) });
  if (operationError) throw new Error(operationError.message);
  try {
    const result = await provider.stop(experiment.provider_experiment_id);
    const operationUpdate = await service.from("paid_growth_operations").update({ state: "completed", result_snapshot: result.raw, provider_resource_id: experiment.provider_experiment_id, completed_at: now }).eq("provider", experiment.provider).eq("operation_key", operationKey);
    if (operationUpdate.error) throw new Error(operationUpdate.error.message);
    const experimentUpdate = await service.from("paid_growth_experiments").update({ state: experiment.verified_outcome ? "completed" : "stopped", ends_at: now }).eq("id", experiment.id);
    if (experimentUpdate.error) throw new Error(experimentUpdate.error.message);
    await auditEvent(experiment, "paid_growth.stopped", "provider", json({ providerExperimentId: experiment.provider_experiment_id }));
  } catch (error) {
    await service.from("paid_growth_operations").update({ state: "ambiguous", error: error instanceof Error ? error.message : "Provider stop result is unknown" }).eq("provider", experiment.provider).eq("operation_key", operationKey);
    throw error;
  }
  refreshPaidGrowth(experiment.id);
}
