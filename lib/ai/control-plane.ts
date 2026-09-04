import "server-only";

import { createHash } from "node:crypto";
import { generateGatewayStructured } from "./gateway";
import { learnedRouteForTask } from "./learning";
import { atlasAiTaskPolicy, type AtlasAiTaskType } from "./tasks";
import { noQualityGate, type AtlasQualityGate, type AtlasQualityResult } from "./quality";
import { createMarketingServiceClient } from "@/lib/marketing/db";
import type { Json } from "@/types/database";
import type { AiControlSettings } from "@/types/marketing-database";

export const ZERO_COST_TEXT_BUDGET_USD = 2.25;

const DEFAULT_SETTINGS: Omit<AiControlSettings, "created_at" | "updated_at"> = {
  owner_id: "",
  routing_mode: "auto",
  monthly_budget_usd: ZERO_COST_TEXT_BUDGET_USD,
  text_budget_usd: ZERO_COST_TEXT_BUDGET_USD,
  image_budget_usd: 0,
  video_budget_usd: 0,
  hard_stop: true,
  quality_escalation: true,
  provider_sort: "cost",
  task_overrides: {},
};

function asJson(value: unknown) {
  return value as Json;
}

function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function numeric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function taskCacheKey(input: RunTaskInput<unknown>) {
  const fingerprint = stableValue({
    artistId: input.artistId ?? null,
    task: input.task,
    promptVersion: input.promptVersion,
    schema: input.schema,
    instructions: input.instructions,
    input: input.input,
    inputContext: input.inputContext ?? {},
  });
  return createHash("sha256").update(JSON.stringify(fingerprint)).digest("hex");
}

export type AiBudgetSnapshot = {
  monthStart: string;
  totalSpentUsd: number;
  textSpentUsd: number;
  monthlyBudgetUsd: number;
  textBudgetUsd: number;
  monthlyRemainingUsd: number;
  textRemainingUsd: number;
};

export function isZeroCostPolicy(settings: AiControlSettings) {
  return settings.hard_stop
    && settings.routing_mode === "auto"
    && settings.provider_sort === "cost"
    && Number(settings.monthly_budget_usd) <= ZERO_COST_TEXT_BUDGET_USD
    && Number(settings.text_budget_usd) <= ZERO_COST_TEXT_BUDGET_USD
    && Number(settings.image_budget_usd) <= 0
    && Number(settings.video_budget_usd) <= 0;
}

export async function loadAiControlSettings(ownerId: string): Promise<AiControlSettings> {
  const client = createMarketingServiceClient();
  const { data, error } = await client.from("ai_control_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  const row = { ...DEFAULT_SETTINGS, owner_id: ownerId };
  const { data: created, error: createError } = await client.from("ai_control_settings").insert(row).select("*").maybeSingle();
  if (!createError && created) return created;

  const { data: raced, error: racedError } = await client.from("ai_control_settings").select("*").eq("owner_id", ownerId).single();
  if (racedError || !raced) throw new Error(createError?.message || racedError?.message || "AI control settings could not be initialized.");
  return raced;
}

export async function getAiBudgetSnapshot(ownerId: string, settings?: AiControlSettings): Promise<AiBudgetSnapshot> {
  const client = createMarketingServiceClient();
  const resolvedSettings = settings ?? await loadAiControlSettings(ownerId);
  const start = monthStartIso();
  const { data, error } = await client.from("generation_runs")
    .select("task_type,actual_cost_usd,estimated_cost_usd,status")
    .eq("owner_id", ownerId)
    .gte("created_at", start)
    .in("status", ["completed", "running"]);
  if (error) throw new Error(error.message);

  let totalSpentUsd = 0;
  let textSpentUsd = 0;
  for (const run of data ?? []) {
    const cost = numeric(run.actual_cost_usd ?? run.estimated_cost_usd);
    totalSpentUsd += cost;
    if (run.task_type) textSpentUsd += cost;
  }
  totalSpentUsd = Number(totalSpentUsd.toFixed(6));
  textSpentUsd = Number(textSpentUsd.toFixed(6));
  return {
    monthStart: start,
    totalSpentUsd,
    textSpentUsd,
    monthlyBudgetUsd: Number(resolvedSettings.monthly_budget_usd),
    textBudgetUsd: Number(resolvedSettings.text_budget_usd),
    monthlyRemainingUsd: Math.max(0, Number(resolvedSettings.monthly_budget_usd) - totalSpentUsd),
    textRemainingUsd: Math.max(0, Number(resolvedSettings.text_budget_usd) - textSpentUsd),
  };
}

export class AtlasAiBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasAiBudgetError";
  }
}

export class AtlasAiQualityError extends Error {
  readonly quality: AtlasQualityResult;
  constructor(task: AtlasAiTaskType, quality: AtlasQualityResult) {
    super(`Atlas AI quality gate failed for ${task}: ${quality.failures.join("; ") || `score ${quality.score.toFixed(2)} below threshold`}`);
    this.name = "AtlasAiQualityError";
    this.quality = quality;
  }
}

async function enforceBudget(ownerId: string, settings: AiControlSettings) {
  if (!settings.hard_stop) return getAiBudgetSnapshot(ownerId, settings);
  const budget = await getAiBudgetSnapshot(ownerId, settings);
  if (budget.monthlyBudgetUsd <= 0 || budget.totalSpentUsd >= budget.monthlyBudgetUsd) {
    throw new AtlasAiBudgetError(`Atlas monthly AI budget is exhausted ($${budget.totalSpentUsd.toFixed(2)} / $${budget.monthlyBudgetUsd.toFixed(2)}).`);
  }
  if (budget.textBudgetUsd <= 0 || budget.textSpentUsd >= budget.textBudgetUsd) {
    throw new AtlasAiBudgetError(`Atlas text/reasoning AI budget is exhausted ($${budget.textSpentUsd.toFixed(2)} / $${budget.textBudgetUsd.toFixed(2)}).`);
  }
  return budget;
}

export async function assertSpecialistMediaSpendAllowed(input: {
  ownerId: string;
  kind: "image" | "video";
  estimatedUsd?: number | null;
  externalTotalSpentUsd?: number | null;
  externalKindSpentUsd?: number | null;
}) {
  const settings = await loadAiControlSettings(input.ownerId);
  if (!settings.hard_stop) return settings;

  const limit = Number(input.kind === "image" ? settings.image_budget_usd : settings.video_budget_usd);
  if (limit <= 0) {
    throw new AtlasAiBudgetError(
      `Atlas Zero Cost guard blocks paid ${input.kind} generation. Increase the ${input.kind} budget explicitly in AI & Generation before approving spend.`,
    );
  }

  if (input.estimatedUsd === null || input.estimatedUsd === undefined || !Number.isFinite(input.estimatedUsd) || input.estimatedUsd < 0) {
    throw new AtlasAiBudgetError(
      `Atlas cannot verify the ${input.kind} hard cap because this provider request has no reliable USD estimate. Keep Zero Cost enabled or configure verified provider pricing before approving spend.`,
    );
  }

  const budget = await getAiBudgetSnapshot(input.ownerId, settings);
  const requested = numeric(input.estimatedUsd);
  const externalTotalSpent = numeric(input.externalTotalSpentUsd ?? 0);
  if (budget.monthlyBudgetUsd <= 0 || budget.totalSpentUsd + externalTotalSpent + requested > budget.monthlyBudgetUsd + 0.000001) {
    throw new AtlasAiBudgetError(
      `This ${input.kind} generation would exceed the monthly AI budget ($${(budget.totalSpentUsd + externalTotalSpent).toFixed(2)} + $${requested.toFixed(2)} > $${budget.monthlyBudgetUsd.toFixed(2)}).`,
    );
  }

  if (requested > 0) {
    const client = createMarketingServiceClient();
    const { data, error } = await client.from("generation_runs")
      .select("actual_cost_usd,estimated_cost_usd,input_context")
      .eq("owner_id", input.ownerId)
      .gte("created_at", monthStartIso())
      .like("purpose", "content_asset:%")
      .in("status", ["running", "completed"]);
    if (error) throw new Error(error.message);
    const marketingSpent = (data ?? []).reduce((sum, run) => {
      const context = run.input_context && typeof run.input_context === "object" && !Array.isArray(run.input_context)
        ? run.input_context as Record<string, unknown>
        : {};
      if (context.outputKind !== input.kind) return sum;
      return sum + numeric(run.actual_cost_usd ?? run.estimated_cost_usd);
    }, 0);
    const spent = marketingSpent + numeric(input.externalKindSpentUsd ?? 0);
    if (spent + requested > limit + 0.000001) {
      throw new AtlasAiBudgetError(
        `This ${input.kind} generation would exceed its budget ($${spent.toFixed(2)} + $${requested.toFixed(2)} > $${limit.toFixed(2)}).`,
      );
    }
  }

  return settings;
}

export type AtlasAiTaskResult<T> = {
  value: T;
  provider: "vercel-gateway";
  model: string;
  requestedModel: string;
  routedProvider: string | null;
  requestId: string | null;
  generationId: string | null;
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  runId: string;
  rootRunId: string;
  escalated: boolean;
  learnedRoutingApplied: boolean;
  cacheHit: boolean;
  quality: AtlasQualityResult;
};

type RunTaskInput<T> = {
  ownerId: string;
  artistId?: string | null;
  task: AtlasAiTaskType;
  purpose?: string;
  campaignId?: string | null;
  releaseId?: string | null;
  videoProjectId?: string | null;
  promptVersion: string;
  schema: Record<string, unknown>;
  instructions: string;
  input: string;
  inputContext?: unknown;
  qualityGate?: AtlasQualityGate<T>;
  timeoutMs?: number;
  metadata?: unknown;
  cacheMode?: "use" | "refresh" | "off";
};

async function cachedTaskResult<T>(input: RunTaskInput<T>, cacheKey: string): Promise<AtlasAiTaskResult<T> | null> {
  const client = createMarketingServiceClient();
  let sourceQuery = client.from("generation_runs")
    .select("id,output,model,requested_model,routed_provider,quality_score,quality_failures")
    .eq("owner_id", input.ownerId);
  if (input.artistId) sourceQuery = sourceQuery.eq("artist_id", input.artistId);
  const { data: source, error } = await sourceQuery
    .eq("provider", "vercel-gateway")
    .contains("metadata", { cacheKey, cacheEligible: true })
    .eq("status", "completed")
    .eq("quality_gate_passed", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!source) return null;

  const now = new Date().toISOString();
  const { data: alias, error: aliasError } = await client.from("generation_runs").insert({
    owner_id: input.ownerId,
    ...(input.artistId ? { artist_id: input.artistId } : {}),
    campaign_id: input.campaignId ?? null,
    release_id: input.releaseId ?? null,
    video_project_id: input.videoProjectId ?? null,
    parent_run_id: null,
    purpose: input.purpose ?? input.task,
    task_type: input.task,
    provider: "atlas-cache",
    model: source.model,
    requested_model: source.requested_model || source.model,
    routed_provider: source.routed_provider,
    prompt_version: input.promptVersion,
    input_context: asJson(input.inputContext ?? {}),
    output: source.output,
    status: "completed",
    attempt_index: 0,
    started_at: now,
    completed_at: now,
    latency_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
    fallback_used: false,
    fallback_count: 0,
    escalated: false,
    quality_gate_passed: true,
    quality_score: source.quality_score,
    quality_failures: source.quality_failures,
    metadata: asJson({
      cacheHit: true,
      cacheSourceRunId: source.id,
      cacheKey,
      cacheEligible: false,
      artistId: input.artistId ?? null,
    }),
  }).select("id").single();
  if (aliasError || !alias) throw new Error(aliasError?.message || "Could not persist AI cache provenance.");

  const failures = Array.isArray(source.quality_failures)
    ? source.quality_failures.filter((item): item is string => typeof item === "string")
    : [];
  return {
    value: source.output as T,
    provider: "vercel-gateway",
    model: source.model,
    requestedModel: source.requested_model || source.model,
    routedProvider: source.routed_provider,
    requestId: null,
    generationId: null,
    estimatedCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    runId: alias.id,
    rootRunId: alias.id,
    escalated: false,
    learnedRoutingApplied: false,
    cacheHit: true,
    quality: {
      passed: true,
      score: typeof source.quality_score === "number" ? source.quality_score : 1,
      failures,
    },
  };
}

export async function runAtlasAiTask<T>(input: RunTaskInput<T>): Promise<AtlasAiTaskResult<T>> {
  const client = createMarketingServiceClient();
  const settings = await loadAiControlSettings(input.ownerId);
  const cacheMode = input.cacheMode ?? "use";
  const cacheKey = taskCacheKey(input as RunTaskInput<unknown>);
  if (cacheMode === "use") {
    const cached = await cachedTaskResult<T>(input, cacheKey);
    if (cached) return cached;
  }

  const budget = await enforceBudget(input.ownerId, settings);
  const policy = atlasAiTaskPolicy(input.task, settings);
  if (!policy.models.length) throw new Error(`Atlas AI task ${input.task} has no configured models.`);
  const learnedRouting = await learnedRouteForTask({ ownerId: input.ownerId, settings, policy }).catch(() => ({
    applied: false,
    reason: "Adaptive evidence is temporarily unavailable; using the configured route.",
    route: policy.models,
    evidence: [],
  }));
  const primaryModels = learnedRouting.route.length ? learnedRouting.route : policy.models;

  const runAttempt = async ({
    models,
    attemptIndex,
    parentRunId,
    escalationReason,
  }: {
    models: string[];
    attemptIndex: number;
    parentRunId: string | null;
    escalationReason?: string | null;
  }) => {
    const [model, ...fallbackModels] = models;
    const started = new Date();
    const extraMetadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata as Record<string, unknown>
      : {};
    const runMetadata = {
      ...extraMetadata,
      artistId: input.artistId ?? null,
      policyTier: policy.tier,
      configuredRoute: policy.models,
      route: models,
      semanticEscalationRoute: policy.escalationModels,
      providerSort: settings.provider_sort,
      budgetAtStart: budget,
      cacheKey,
      cacheMode,
      cacheEligible: cacheMode !== "off",
      adaptiveLearning: {
        applied: learnedRouting.applied,
        reason: learnedRouting.reason,
        route: learnedRouting.route,
      },
    };
    const { data: run, error: createError } = await client.from("generation_runs").insert({
      owner_id: input.ownerId,
      ...(input.artistId ? { artist_id: input.artistId } : {}),
      campaign_id: input.campaignId ?? null,
      release_id: input.releaseId ?? null,
      video_project_id: input.videoProjectId ?? null,
      parent_run_id: parentRunId,
      purpose: input.purpose ?? input.task,
      task_type: input.task,
      provider: "vercel-gateway",
      model,
      requested_model: model,
      prompt_version: input.promptVersion,
      input_context: asJson(input.inputContext ?? {}),
      output: asJson({}),
      status: "running",
      attempt_index: attemptIndex,
      started_at: started.toISOString(),
      escalation_reason: escalationReason ?? null,
      metadata: asJson(runMetadata),
    }).select("id").single();
    if (createError || !run) throw new Error(createError?.message || "AI generation run could not be created.");

    try {
      const gateway = await generateGatewayStructured<T>({
        name: input.task.replaceAll(".", "_"),
        schema: input.schema,
        instructions: input.instructions,
        input: input.input,
        model,
        fallbackModels,
        timeoutMs: input.timeoutMs,
        providerSort: settings.provider_sort,
      });
      const rawQuality = input.qualityGate ? await input.qualityGate(gateway.value) : noQualityGate();
      const quality: AtlasQualityResult = {
        ...rawQuality,
        passed: rawQuality.passed && rawQuality.score >= policy.qualityThreshold,
      };
      const completed = new Date();
      const fallbackUsed = gateway.model !== gateway.requestedModel;
      let updateQuery = client.from("generation_runs").update({
        model: gateway.model,
        requested_model: gateway.requestedModel,
        routed_provider: gateway.routedProvider,
        gateway_generation_id: gateway.generationId,
        provider_request_id: gateway.requestId,
        output: asJson(gateway.value),
        status: "completed",
        completed_at: completed.toISOString(),
        latency_ms: completed.getTime() - started.getTime(),
        input_tokens: gateway.inputTokens,
        output_tokens: gateway.outputTokens,
        estimated_cost_usd: gateway.estimatedCostUsd,
        actual_cost_usd: gateway.estimatedCostUsd,
        fallback_used: fallbackUsed,
        fallback_count: fallbackUsed ? 1 : 0,
        quality_gate_passed: quality.passed,
        quality_score: quality.score,
        quality_failures: asJson(quality.failures),
      }).eq("id", run.id);
      if (input.artistId) updateQuery = updateQuery.eq("artist_id", input.artistId);
      const { error: updateError } = await updateQuery;
      if (updateError) throw new Error(updateError.message);
      return { gateway, quality, runId: run.id };
    } catch (error) {
      const completed = new Date();
      let failQuery = client.from("generation_runs").update({
        status: "failed",
        completed_at: completed.toISOString(),
        latency_ms: completed.getTime() - started.getTime(),
        error: error instanceof Error ? error.message : "Unknown AI task failure",
      }).eq("id", run.id);
      if (input.artistId) failQuery = failQuery.eq("artist_id", input.artistId);
      await failQuery;
      throw error;
    }
  };

  const result = (
    attempt: Awaited<ReturnType<typeof runAttempt>>,
    rootRunId: string,
    escalated: boolean,
  ): AtlasAiTaskResult<T> => ({
    value: attempt.gateway.value,
    provider: "vercel-gateway",
    model: attempt.gateway.model,
    requestedModel: attempt.gateway.requestedModel,
    routedProvider: attempt.gateway.routedProvider,
    requestId: attempt.gateway.requestId,
    generationId: attempt.gateway.generationId,
    estimatedCostUsd: attempt.gateway.estimatedCostUsd,
    inputTokens: attempt.gateway.inputTokens,
    outputTokens: attempt.gateway.outputTokens,
    runId: attempt.runId,
    rootRunId,
    escalated,
    learnedRoutingApplied: learnedRouting.applied,
    cacheHit: false,
    quality: attempt.quality,
  });

  const first = await runAttempt({ models: primaryModels, attemptIndex: 0, parentRunId: null });
  if (first.quality.passed) return result(first, first.runId, false);
  if (!settings.quality_escalation || !policy.escalationModels.length) {
    throw new AtlasAiQualityError(input.task, first.quality);
  }

  let last = first;
  let reason = first.quality.failures.join("; ") || `quality score ${first.quality.score.toFixed(2)}`;
  let firstEscalationQuery = client.from("generation_runs").update({
    escalated: true,
    escalation_reason: reason,
  }).eq("id", first.runId);
  if (input.artistId) firstEscalationQuery = firstEscalationQuery.eq("artist_id", input.artistId);
  const { error: firstEscalationError } = await firstEscalationQuery;
  if (firstEscalationError) throw new Error(firstEscalationError.message);

  for (let index = 0; index < policy.escalationModels.length; index += 1) {
    await enforceBudget(input.ownerId, settings);
    const attempt = await runAttempt({
      models: [policy.escalationModels[index]],
      attemptIndex: index + 1,
      parentRunId: first.runId,
      escalationReason: reason,
    });
    if (attempt.quality.passed) return result(attempt, first.runId, true);
    last = attempt;
    reason = attempt.quality.failures.join("; ") || `quality score ${attempt.quality.score.toFixed(2)}`;
    let escalationUpdateQuery = client.from("generation_runs").update({
      escalated: true,
      escalation_reason: reason,
    }).eq("id", attempt.runId);
    if (input.artistId) escalationUpdateQuery = escalationUpdateQuery.eq("artist_id", input.artistId);
    const { error: escalationUpdateError } = await escalationUpdateQuery;
    if (escalationUpdateError) throw new Error(escalationUpdateError.message);
  }

  throw new AtlasAiQualityError(input.task, last.quality);
}
