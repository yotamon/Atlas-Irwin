import "server-only";

import { randomBytes } from "node:crypto";
import type { SocialPlatformKey } from "./social-platforms";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

const AUTOMATION_SCOPES: Record<SocialPlatformKey, string[]> = {
  instagram: [
    "instagram_business_basic",
    "instagram_business_content_publish",
    "instagram_business_manage_insights",
    "instagram_business_manage_comments",
    "instagram_business_manage_messages",
  ],
  tiktok: [
    "user.info.basic",
    "video.list",
    "video.upload",
  ],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ],
};

function truthyEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(process.env[name]?.trim().toLowerCase() || "");
}

function clientId(platform: SocialPlatformKey) {
  if (platform === "instagram") {
    const value = process.env.INSTAGRAM_APP_ID?.trim();
    if (!value || !process.env.INSTAGRAM_APP_SECRET?.trim()) throw new Error("Instagram OAuth environment variables are missing.");
    return value;
  }
  if (platform === "tiktok") {
    const value = process.env.TIKTOK_CLIENT_KEY?.trim();
    if (!value || !process.env.TIKTOK_CLIENT_SECRET?.trim()) throw new Error("TikTok OAuth environment variables are missing.");
    return value;
  }
  const value = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  if (!value || !process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim()) throw new Error("YouTube OAuth environment variables are missing.");
  return value;
}

function redirectUri(platform: SocialPlatformKey, origin: string) {
  const explicit = platform === "instagram"
    ? process.env.INSTAGRAM_REDIRECT_URI?.trim()
    : platform === "tiktok"
      ? process.env.TIKTOK_REDIRECT_URI?.trim()
      : process.env.YOUTUBE_REDIRECT_URI?.trim();
  return explicit || `${origin.replace(/\/$/, "")}/studio/settings/social/${platform}/callback`;
}

export function automationScopes(platform: SocialPlatformKey) {
  const scopes = [...AUTOMATION_SCOPES[platform]];
  if (platform === "tiktok" && truthyEnv("TIKTOK_DIRECT_POST_AUDITED")) {
    scopes.push("video.publish");
  }
  return scopes;
}

export function createAutomationSocialAuthorizeUrl(platform: SocialPlatformKey, origin: string) {
  const id = clientId(platform);
  const callback = redirectUri(platform, origin);
  const scopes = automationScopes(platform);
  const state = randomBytes(32).toString("base64url");

  if (platform === "instagram") {
    const url = new URL(INSTAGRAM_AUTHORIZE_URL);
    url.searchParams.set("client_id", id);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return { url, state, scopes };
  }

  if (platform === "tiktok") {
    const url = new URL(TIKTOK_AUTHORIZE_URL);
    url.searchParams.set("client_key", id);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return { url, state, scopes };
  }

  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", id);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { url, state, scopes };
}
