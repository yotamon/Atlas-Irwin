import "server-only";

import type { Json } from "@/types/database";

export type ChannelCapability = {
  id: string;
  label: string;
  automatedPublishing: boolean;
  automatedMetrics: boolean;
  reason?: string;
};

export type PublishRequest = {
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

class ManualHandoffAdapter implements MarketingChannelAdapter {
  constructor(private readonly platform: string) {}

  capability(): ChannelCapability {
    return {
      id: `manual:${this.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: `${this.platform} manual handoff`,
      automatedPublishing: false,
      automatedMetrics: false,
      reason: "No authenticated first-party publishing connection is configured for this channel yet.",
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    return {
      status: "manual_handoff",
      details: {
        platform: request.platform,
        caption: request.caption,
        hookText: request.hookText,
        cta: request.cta,
        assetUrl: request.assetUrl,
        attributionUrl: request.attributionUrl,
      },
    };
  }

  async fetchMetrics() {
    return null;
  }
}

export function channelAdapter(platform: string): MarketingChannelAdapter {
  return new ManualHandoffAdapter(platform);
}

export function channelCapabilities(platforms: string[]) {
  return platforms.map((platform) => channelAdapter(platform).capability());
}
