import "server-only";

import type { Json } from "@/types/database";
import { socialPlatformForPlannerPlatform, type SocialPlatformKey } from "./social-platforms";
import type { ChannelCapability, MarketingChannelAdapter, PublishRequest, PublishResult } from "./channel-types";
import { InstagramChannelAdapter } from "./channels/instagram";
import { TikTokChannelAdapter } from "./channels/tiktok";
import { YouTubeChannelAdapter } from "./channels/youtube";

export type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, PublishRequest, PublishResult } from "./channel-types";

class ManualHandoffAdapter implements MarketingChannelAdapter {
  constructor(private readonly platform: string) {}

  capability(): ChannelCapability {
    return {
      id: `manual:${this.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: `${this.platform} manual handoff`,
      automatedPublishing: false,
      automatedMetrics: false,
      reason: "No first-party publishing adapter exists for this channel.",
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
      } as Json,
    };
  }

  async fetchMetrics() {
    return null;
  }
}

export function channelAdapter(platform: string): MarketingChannelAdapter {
  const key: SocialPlatformKey | null = socialPlatformForPlannerPlatform(platform);
  if (key === "instagram") return new InstagramChannelAdapter();
  if (key === "tiktok") return new TikTokChannelAdapter();
  if (key === "youtube") return new YouTubeChannelAdapter();
  return new ManualHandoffAdapter(platform);
}

export function channelCapabilities(platforms: string[]) {
  return platforms.map((platform) => channelAdapter(platform).capability());
}
