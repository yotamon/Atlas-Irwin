import "server-only";

import type { Json } from "@/types/database";

export type PaidGrowthLaunchInput = {
  experimentId: string;
  provider: string;
  platform: string;
  title: string;
  objective: string;
  hypothesis: string;
  destinationUrl: string;
  sourceCode: string;
  budgetCeilingUsd: number;
  dailyBudgetUsd: number | null;
  geoCountries: string[];
  audience: Json;
  creative: { contentItemId: string | null; assetUrl: string | null; title: string | null };
};

export type PaidGrowthProviderSnapshot = {
  providerReference: string;
  impressions: number;
  clicks: number;
  spendCents: number;
  raw: Json;
  observedAt: string;
  verified: boolean;
};

export interface PaidGrowthProvider {
  readonly id: string;
  readonly configured: boolean;
  readonly reasonUnavailable: string | null;
  launch(input: PaidGrowthLaunchInput): Promise<{ providerExperimentId: string; raw: Json }>;
  pause(providerExperimentId: string): Promise<{ raw: Json }>;
  resume(providerExperimentId: string): Promise<{ raw: Json }>;
  stop(providerExperimentId: string): Promise<{ raw: Json }>;
  sync(providerExperimentId: string): Promise<PaidGrowthProviderSnapshot>;
}

class UnconfiguredPaidGrowthProvider implements PaidGrowthProvider {
  readonly configured = false;
  readonly reasonUnavailable: string;

  constructor(readonly id: string) {
    this.reasonUnavailable = `${id} paid-media execution is not connected. The experiment can still be prepared, approved and evaluated with first-party evidence, but Ensemblis will not pretend an external campaign was launched.`;
  }

  private unavailable(): never {
    throw new Error(this.reasonUnavailable);
  }

  async launch() { return this.unavailable(); }
  async pause() { return this.unavailable(); }
  async resume() { return this.unavailable(); }
  async stop() { return this.unavailable(); }
  async sync() { return this.unavailable(); }
}

export function getPaidGrowthProvider(provider: string): PaidGrowthProvider {
  // Provider-specific adapters intentionally plug in here. No paid network currently has a
  // production credential/runtime contract in Ensemblis, so v1 fails closed instead of faking it.
  return new UnconfiguredPaidGrowthProvider(provider.trim().toLowerCase() || "paid-media");
}
