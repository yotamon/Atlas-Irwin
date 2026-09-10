import "server-only";

import { HiggsfieldProvider } from "@/lib/video-providers/higgsfield/client";
import type {
  ExtendedMusicVideoProject,
  ExtendedMusicVideoShot,
} from "@/types/video-database";
import { routeVideoShot } from "./model-router";
import {
  VIDEO_PRODUCTION_PROFILES,
  productionProfileDefinition,
  type VideoProductionProfile,
  type VideoProductionProfilePreview,
  type VideoProfileModelMixItem,
} from "./production-profile";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function providerUsdPerCredit() {
  const value = Number(process.env.HIGGSFIELD_USD_PER_CREDIT);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function paidSource(strategy: ExtendedMusicVideoShot["reuse_strategy"]) {
  return strategy === "unique" || strategy === "continuation";
}

function durationForGeneration(shot: ExtendedMusicVideoShot, model: string) {
  const seconds = Math.max(0.1, (shot.end_ms - shot.start_ms) / 1000);
  const minimum = model === "kling3_0" ? 3 : 4;
  const maximum = model === "seedance_2_5" ? 30 : 15;
  return Math.max(minimum, Math.min(maximum, Math.ceil(seconds)));
}

function testShotIndexes(project: ExtendedMusicVideoProject) {
  const plan = record(project.production_plan);
  const value = plan.test_shot_indexes;
  return new Set(Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item)) : []);
}

function fixedLookCredits(project: ExtendedMusicVideoProject) {
  const plan = record(project.production_plan);
  const cost = record(plan.cost_estimate);
  return {
    expected: typeof cost.look_dev_credits === "number" ? cost.look_dev_credits : 0,
    reserve: typeof cost.look_dev_reserve_credits === "number" ? cost.look_dev_reserve_credits : 0,
  };
}

export async function buildProductionProfilePreview(input: {
  project: ExtendedMusicVideoProject;
  shots: ExtendedMusicVideoShot[];
  profile: VideoProductionProfile;
}): Promise<VideoProductionProfilePreview> {
  const provider = new HiggsfieldProvider();
  const usdPerCredit = providerUsdPerCredit();
  const tests = testShotIndexes(input.project);
  const fixedLook = fixedLookCredits(input.project);
  const definition = productionProfileDefinition(input.profile);
  const shotPreviews: VideoProductionProfilePreview["shots"] = [];

  for (const shot of input.shots) {
    if (!paidSource(shot.reuse_strategy)) continue;
    const routing = routeVideoShot({
      generation_priority: shot.generation_priority,
      capability_profile: shot.capability_profile,
      start_asset_id: shot.start_asset_id,
      end_asset_id: shot.end_asset_id,
      reference_asset_ids: shot.reference_asset_ids,
      music_context: shot.music_context,
      targetResolution: input.project.target_resolution,
      isTest: tests.has(shot.display_order),
      productionProfile: input.profile,
    });
    if (routing.provider !== "higgsfield") {
      throw new Error(`Profile preview does not have a quote adapter for provider ${routing.provider}.`);
    }
    const generationSeconds = durationForGeneration(shot, routing.model);
    const quote = await provider.quote({
      operation: tests.has(shot.display_order) ? "test_video" : "shot_video",
      model: routing.model,
      prompt: shot.prompt || shot.description,
      negativePrompt: shot.negative_prompt,
      durationSeconds: generationSeconds,
      aspectRatio: input.project.primary_aspect_ratio,
      resolution: input.project.target_resolution,
      params: routing.params,
    });
    shotPreviews.push({
      shotId: shot.id,
      displayOrder: shot.display_order,
      model: routing.model,
      modelLabel: routing.modelLabel,
      provider: routing.provider,
      providerLabel: routing.providerLabel,
      reason: routing.reason,
      generationSeconds,
      expectedCredits: quote.credits,
      reserveCredits: quote.reserveCredits,
      expectedUsd: usdPerCredit === null ? null : Number((quote.credits * usdPerCredit).toFixed(2)),
      reserveUsd: usdPerCredit === null ? null : Number((quote.reserveCredits * usdPerCredit).toFixed(2)),
      alternatives: routing.alternatives.map((item) => ({
        model: item.model,
        modelLabel: item.modelLabel,
        provider: item.provider,
        providerLabel: item.providerLabel,
      })),
    });
  }

  const mix = new Map<string, Omit<VideoProfileModelMixItem, "share">>();
  for (const shot of shotPreviews) {
    const key = `${shot.provider}:${shot.model}`;
    const current = mix.get(key) ?? {
      model: shot.model,
      modelLabel: shot.modelLabel,
      provider: shot.provider,
      providerLabel: shot.providerLabel,
      shotCount: 0,
      generationSeconds: 0,
      expectedCredits: 0,
      reserveCredits: 0,
      expectedUsd: usdPerCredit === null ? null : 0,
      reserveUsd: usdPerCredit === null ? null : 0,
    };
    current.shotCount += 1;
    current.generationSeconds += shot.generationSeconds;
    current.expectedCredits += shot.expectedCredits;
    current.reserveCredits += shot.reserveCredits;
    if (current.expectedUsd !== null) current.expectedUsd += shot.expectedUsd ?? 0;
    if (current.reserveUsd !== null) current.reserveUsd += shot.reserveUsd ?? 0;
    mix.set(key, current);
  }

  const generatedSeconds = [...mix.values()].reduce((sum, item) => sum + item.generationSeconds, 0);
  const modelMix = [...mix.values()]
    .map((item): VideoProfileModelMixItem => ({
      ...item,
      generationSeconds: Number(item.generationSeconds.toFixed(1)),
      expectedCredits: Number(item.expectedCredits.toFixed(2)),
      reserveCredits: Number(item.reserveCredits.toFixed(2)),
      expectedUsd: item.expectedUsd === null ? null : Number(item.expectedUsd.toFixed(2)),
      reserveUsd: item.reserveUsd === null ? null : Number(item.reserveUsd.toFixed(2)),
      share: generatedSeconds > 0 ? Math.round((item.generationSeconds / generatedSeconds) * 100) : 0,
    }))
    .sort((a, b) => b.generationSeconds - a.generationSeconds);

  const videoExpectedCredits = shotPreviews.reduce((sum, item) => sum + item.expectedCredits, 0);
  const videoReserveCredits = shotPreviews.reduce((sum, item) => sum + item.reserveCredits, 0);
  const expectedCredits = videoExpectedCredits + fixedLook.expected;
  const reserveCredits = videoReserveCredits + fixedLook.reserve;

  return {
    profile: input.profile,
    label: definition.label,
    description: definition.description,
    pricingAvailable: usdPerCredit !== null,
    expectedCredits: Number(expectedCredits.toFixed(2)),
    reserveCredits: Number(reserveCredits.toFixed(2)),
    expectedUsd: usdPerCredit === null ? null : Number((expectedCredits * usdPerCredit).toFixed(2)),
    reserveUsd: usdPerCredit === null ? null : Number((reserveCredits * usdPerCredit).toFixed(2)),
    modelMix,
    shots: shotPreviews,
  };
}

export async function buildProductionProfilePreviews(input: {
  project: ExtendedMusicVideoProject;
  shots: ExtendedMusicVideoShot[];
}) {
  return Promise.all(VIDEO_PRODUCTION_PROFILES.map((profile) => buildProductionProfilePreview({
    ...input,
    profile,
  })));
}
