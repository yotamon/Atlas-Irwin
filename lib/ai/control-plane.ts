import "server-only";

import { generateGatewayStructured } from "./gateway";
import { learnedRouteForTask } from "./learning";
import { atlasAiTaskPolicy, type AtlasAiTaskType } from "./tasks";
import { noQualityGate, type AtlasQualityGate, type AtlasQualityResult } from "./quality";
import { createMarketingServiceClient } from "@/lib/marketing/db";
import type { Json } from "@/types/database";
import type { AiControlSettings } from "@/types/marketing-database";

const DEFAULT_SETTINGS: Omit<AiControlSettings, "created_at" | "updated_at"> = {
  owner_id: "",
  routing_mode: "auto",
  monthly_budget_usd: 30,
  text_budget_usd: 10,
  image_budget_usd: 8,
  video_budget_usd: 12,
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

export type AiBudgetSnapshot = {
  monthStart: string;
  totalSpentUsd: number;
  textSpentUsd: number;
  monthlyBudgetUsd: number;
  textBudgetUsd: number;
  monthlyRemainingUsd: number;
  textRemainingUsd: number;
};

export async function loadAiControlSettings(ownerId: string): Promise<AiControlSettings> {
  const client = createMarketingServiceClient();
  const { data, error } = await client.from("ai_control_settings").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;

  const row = { ...DEFAULT_SETTINGS, owner_id: ownerId };
  const { data: created, error: createError } = await client.from("ai_control_settings").insert(row).select("*").maybeSingle();
  if (!createError && created) return created;

  // A concurrent first request may have created the singleton row.
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
    // Control Plane v1 only routes language/reasoning tasks. Specialist media keeps its own hard-credit envelope.
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
  quality: AtlasQualityResult;
};

type RunTaskInput<T> = {
  ownerId: string;
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
};

export async function runAtlasAiTask<T>(input: RunTaskInput<T>): Promise<AtlasAiTaskResult<T>> {
  const client = createMarketingServiceClient();
  const settings = await loadAiControlSettings(input.ownerId);
  const budget = await enforceBudget(input.ownerId, settings);
  const policy = atlasAiTaskPolicy(input.task, settings);
  if (!policy.models.length) throw new Error(`Atlas AI task ${input.task} has no configured models.`);
  const learnedRouting = await learnedRouteForTask({ ownerId: input.ownerId, settings, policy });
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
    const { data: run, error: createError } = await client.from("generation_runs").insert({
      owner_id: input.ownerId,
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
      metadata: asJson({
        policyTier: policy.tier,
        configuredRoute: policy.models,
        route: models,
        providerSort: settings.provider_sort,
        budgetAtStart: budget,
        adaptiveLearning: {
          applied: learnedRouting.applied,
          reason: learnedRouting.reason,
          route: learnedRouting.route,
        },
        ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata as Record<string, unknown> : {}),
      }),
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
      const { error: updateError } = await client.from("generation_runs").update({
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
      if (updateError) throw new Error(updateError.message);
      return { gateway, quality, runId: run.id };
    } catch (error) {
      const completed = new Date();
      await client.from("generation_runs").update({
        status: "failed",
        completed_at: completed.toISOString(),
        latency_ms: completed.getTime() - started.getTime(),
        error: error instanceof Error ? error.message : "Unknown AI task failure",
      }).eq("id", run.id);
      throw error;
    }
  };

  const first = await runAttempt({ models: primaryModels, attemptIndex: 0, parentRunId: null });
  if (first.quality.passed) {
    return {
      value: first.gateway.value,
      provider: "vercel-gateway",
      model: first.gateway.model,
      requestedModel: first.gateway.requestedModel,
      routedProvider: first.gateway.routedProvider,
      requestId: first.gateway.requestId,
      generationId: first.gateway.generationId,
      estimatedCostUsd: first.gateway.estimatedCostUsd,
      inputTokens: first.gateway.inputTokens,
      outputTokens: first.gateway.outputTokens,
      runId: first.runId,
      rootRunId: first.runId,
      escalated: false,
      learnedRoutingApplied: learnedRouting.applied,
      quality: first.quality,
    };
  }

  if (!settings.quality_escalation || !policy.escalationModels.length) {
    throw new AtlasAiQualityError(input.task, first.quality);
  }

  const reason = first.quality.failures.join("; ") || `quality score ${first.quality.score.toFixed(2)}`;
  const { error: escalationUpdateError } = await client.from("generation_runs").update({
    escalated: true,
    escalation_reason: reason,
  }).eq("id", first.runId);
  if (escalationUpdateError) throw new Error(escalationUpdateError.message);

  await enforceBudget(input.ownerId, settings);
  const second = await runAttempt({
    models: policy.escalationModels,
    attemptIndex: 1,
    parentRunId: first.runId,
    escalationReason: reason,
  });
  if (!second.quality.passed) throw new AtlasAiQualityError(input.task, second.quality);

  return {
    value: second.gateway.value,
    provider: "vercel-gateway",
    model: second.gateway.model,
    requestedModel: second.gateway.requestedModel,
    routedProvider: second.gateway.routedProvider,
    requestId: second.gateway.requestId,
    generationId: second.gateway.generationId,
    estimatedCostUsd: second.gateway.estimatedCostUsd,
    inputTokens: second.gateway.inputTokens,
    outputTokens: second.gateway.outputTokens,
    runId: second.runId,
    rootRunId: first.runId,
    escalated: true,
    learnedRoutingApplied: learnedRouting.applied,
    quality: second.quality,
  };
}
