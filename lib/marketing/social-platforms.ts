export const SOCIAL_PLATFORM_KEYS = ["instagram", "tiktok", "youtube"] as const;

export type SocialPlatformKey = (typeof SOCIAL_PLATFORM_KEYS)[number];
export type CampaignSocialPlatform = "Instagram" | "TikTok" | "YouTube Shorts";

export type SocialConnectionLike = {
  platform: string;
  status?: string | null;
};

export const SOCIAL_PLATFORM_DEFINITIONS: Record<
  SocialPlatformKey,
  {
    label: string;
    plannerPlatform: CampaignSocialPlatform;
    description: string;
    envVars: readonly string[];
  }
> = {
  instagram: {
    label: "Instagram",
    plannerPlatform: "Instagram",
    description: "Reels and artist-facing visual campaign moments.",
    envVars: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
  },
  tiktok: {
    label: "TikTok",
    plannerPlatform: "TikTok",
    description: "Short-form discovery, hook testing and native TikTok cuts.",
    envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  },
  youtube: {
    label: "YouTube",
    plannerPlatform: "YouTube Shorts",
    description: "YouTube Shorts and release-adjacent video discovery.",
    envVars: ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"],
  },
};

export function isSocialPlatformKey(value: string): value is SocialPlatformKey {
  return (SOCIAL_PLATFORM_KEYS as readonly string[]).includes(value);
}

export function plannerPlatformsFromConnections(
  connections: SocialConnectionLike[],
): CampaignSocialPlatform[] {
  const connected = new Set(
    connections
      .filter((connection) => !connection.status || connection.status === "connected")
      .map((connection) => connection.platform),
  );

  return SOCIAL_PLATFORM_KEYS
    .filter((platform) => connected.has(platform))
    .map((platform) => SOCIAL_PLATFORM_DEFINITIONS[platform].plannerPlatform);
}

export function socialPlatformForPlannerPlatform(
  plannerPlatform: string,
): SocialPlatformKey | null {
  return (
    SOCIAL_PLATFORM_KEYS.find(
      (platform) =>
        SOCIAL_PLATFORM_DEFINITIONS[platform].plannerPlatform === plannerPlatform,
    ) ?? null
  );
}
