import "server-only";

import { normalizeGatewayModel, parseGatewayModelList } from "./gateway";
import type { AiControlSettings, AiRoutingMode } from "@/types/marketing-database";

export type AtlasAiTaskType =
  | "marketing.campaign_plan"
  | "marketing.caption"
  | "marketing.strategy"
  | "metadata.extraction"
  | "video.concepts"
  | "video.production_plan"
  | "video.shot_revision";

export type AtlasAiTier = "economy" | "balanced" | "premium";
export type AtlasAiModality = "text";

export type AtlasAiTaskPolicy = {
  task: AtlasAiTaskType;
  label: string;
  modality: AtlasAiModality;
  tier: AtlasAiTier;
  escalationTier: AtlasAiTier | null;
  qualityThreshold: number;
  models: string[];
  escalationModels: string[];
};

type TaskOverride = {
  tier?: AtlasAiTier;
  escalationTier?: AtlasAiTier | null;
  qualityThreshold?: number;
  models?: string[];
  escalationModels?: string[];
};

function premiumModel() {
  return normalizeGatewayModel(process.env.ATLAS_MARKETING_MODEL?.trim() || "openai/gpt-5.6-sol", "openai");
}

function tierModels(tier: AtlasAiTier) {
  if (tier === "economy") {
    const configured = parseGatewayModelList(process.env.ATLAS_MARKETING_ECONOMY_MODELS);
    return configured.length ? configured : ["zai/glm-4.7-flash"];
  }
  if (tier === "premium") {
    const configured = parseGatewayModelList(process.env.ATLAS_MARKETING_PREMIUM_MODELS);
    return configured.length ? configured : [premiumModel()];
  }
  const configured = parseGatewayModelList(process.env.ATLAS_MARKETING_BALANCED_MODELS);
  return configured.length ? configured : ["openai/gpt-5.6-luna"];
}

function videoModels(tier: AtlasAiTier) {
  if (tier !== "premium") return tierModels(tier);
  const primary = normalizeGatewayModel(process.env.VIDEO_DIRECTOR_LLM_MODEL?.trim() || premiumModel());
  const fallbacks = parseGatewayModelList(process.env.VIDEO_DIRECTOR_LLM_FALLBACK_MODELS);
  return Array.from(new Set([primary, ...fallbacks].filter(Boolean)));
}

const BASE_TASKS: Record<AtlasAiTaskType, Omit<AtlasAiTaskPolicy, "models" | "escalationModels">> = {
  "marketing.campaign_plan": { task: "marketing.campaign_plan", label: "Campaign planning", modality: "text", tier: "balanced", escalationTier: "premium", qualityThreshold: 0.9 },
  "marketing.caption": { task: "marketing.caption", label: "Caption writing", modality: "text", tier: "economy", escalationTier: "balanced", qualityThreshold: 0.85 },
  "marketing.strategy": { task: "marketing.strategy", label: "Marketing strategy", modality: "text", tier: "balanced", escalationTier: "premium", qualityThreshold: 0.9 },
  "metadata.extraction": { task: "metadata.extraction", label: "Metadata extraction", modality: "text", tier: "economy", escalationTier: "balanced", qualityThreshold: 1 },
  "video.concepts": { task: "video.concepts", label: "Video concepts", modality: "text", tier: "balanced", escalationTier: "premium", qualityThreshold: 0.9 },
  "video.production_plan": { task: "video.production_plan", label: "Video production plan", modality: "text", tier: "balanced", escalationTier: "premium", qualityThreshold: 1 },
  "video.shot_revision": { task: "video.shot_revision", label: "Video shot revision", modality: "text", tier: "balanced", escalationTier: "premium", qualityThreshold: 1 },
};

function overrideFor(settings: AiControlSettings | null, task: AtlasAiTaskType): TaskOverride {
  const value = settings?.task_overrides;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const candidate = (value as Record<string, unknown>)[task];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  return candidate as TaskOverride;
}

function tierFromRoutingMode(mode: AiRoutingMode, fallback: AtlasAiTier) {
  return mode === "auto" ? fallback : mode;
}

function cleanModels(models: unknown) {
  if (!Array.isArray(models)) return [];
  return Array.from(new Set(models
    .filter((item): item is string => typeof item === "string")
    .map((item) => normalizeGatewayModel(item))
    .filter(Boolean)));
}

function semanticEscalationModels(tier: AtlasAiTier, escalationTier: AtlasAiTier | null, video: boolean) {
  if (!escalationTier) return [];
  const target = video ? videoModels(escalationTier) : tierModels(escalationTier);
  if (tier === "economy" && escalationTier === "balanced") {
    const premium = video ? videoModels("premium") : tierModels("premium");
    return [...target, ...premium];
  }
  return target;
}

export function atlasAiTaskPolicy(task: AtlasAiTaskType, settings: AiControlSettings | null = null): AtlasAiTaskPolicy {
  const base = BASE_TASKS[task];
  const override = overrideFor(settings, task);
  const tier = tierFromRoutingMode(settings?.routing_mode ?? "auto", override.tier ?? base.tier);
  const forcedMode = Boolean(settings?.routing_mode && settings.routing_mode !== "auto");
  const escalationTier = forcedMode
    ? null
    : override.escalationTier !== undefined ? override.escalationTier : base.escalationTier;

  const isVideoDirector = task.startsWith("video.");
  const defaultModels = isVideoDirector ? videoModels(tier) : tierModels(tier);
  const overriddenModels = cleanModels(override.models);
  const models = overriddenModels.length ? overriddenModels : defaultModels;
  const explicitEscalation = cleanModels(override.escalationModels);
  const escalationModels = explicitEscalation.length
    ? explicitEscalation.filter((model) => !models.includes(model))
    : semanticEscalationModels(tier, escalationTier, isVideoDirector).filter((model) => !models.includes(model));

  const threshold = typeof override.qualityThreshold === "number" && Number.isFinite(override.qualityThreshold)
    ? Math.max(0, Math.min(1, override.qualityThreshold))
    : base.qualityThreshold;

  return {
    ...base,
    tier,
    escalationTier,
    qualityThreshold: threshold,
    models,
    escalationModels: Array.from(new Set(escalationModels)),
  };
}

export function atlasAiTaskRegistry(settings: AiControlSettings | null = null) {
  return (Object.keys(BASE_TASKS) as AtlasAiTaskType[]).map((task) => atlasAiTaskPolicy(task, settings));
}
