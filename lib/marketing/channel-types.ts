import type { Json } from "@/types/database";

export type ChannelCapability = {
  id: string;
  label: string;
  automatedPublishing: boolean;
  automatedMetrics: boolean;
  reason?: string;
};

export type PublishRequest = {
  ownerId: string;
  platform: string;
  caption: string | null;
  hookText: string | null;
  cta: string | null;
  assetUrl: string | null;
  scheduledAt: string | null;
  attributionUrl: string | null;
  metadata: Json;
};

export type PublishResult = {
  status: "published" | "manual_handoff";
  externalPostId?: string;
  externalUrl?: string;
  details?: Json;
};

export type ChannelMetrics = Record<string, number> & {
  externalObjectId?: never;
};

export interface MarketingChannelAdapter {
  capability(): ChannelCapability;
  publish(request: PublishRequest): Promise<PublishResult>;
  fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null>;
}
