import type { VideoGenerationRequest } from "@/lib/video-providers/types";

export const CREATIVE_PROVIDER_IDS = ["bfl", "google", "zai", "fal", "higgsfield"] as const;
export type CreativeProviderId = (typeof CREATIVE_PROVIDER_IDS)[number];

export type CreativeGenerationRequest = VideoGenerationRequest & {
  provider: CreativeProviderId;
};

export type CreativeMoneyQuote = {
  currency: "USD" | "CREDITS";
  amount: number;
  reserveAmount: number;
  exact: boolean;
  source: "official_price_anchor" | "configured" | "provider" | "static_anchor";
  note: string;
  usdEstimate: number | null;
};

export type CreativeProviderStatus = {
  requestId: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw";
  resultUrl?: string;
  resultBase64?: string;
  resultMimeType?: string;
  resultFetchHeaders?: Record<string, string>;
  actualCostUsd?: number | null;
  raw: Record<string, unknown>;
};

export interface CreativeGenerationProvider {
  readonly id: CreativeProviderId;
  quote(request: CreativeGenerationRequest): Promise<CreativeMoneyQuote>;
  submit(request: CreativeGenerationRequest, webhookUrl?: string): Promise<CreativeProviderStatus>;
  status(requestId: string, request: CreativeGenerationRequest): Promise<CreativeProviderStatus>;
}

export type CreativeProviderReadiness = {
  id: CreativeProviderId;
  label: string;
  configured: boolean;
  note: string;
};
