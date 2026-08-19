import "server-only";

import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import {
  SOCIAL_PLATFORM_DEFINITIONS,
  type SocialPlatformKey,
} from "@/lib/marketing/social-platforms";
import type { Json } from "@/types/database";
import type { SocialDatabase } from "@/types/social-database";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const TIKTOK_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_API_URL = "https://open.tiktokapis.com/v2";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";

const BASE_SCOPES: Record<SocialPlatformKey, string[]> = {
  instagram: ["instagram_business_basic"],
  tiktok: ["user.info.basic"],
  youtube: ["https://www.googleapis.com/auth/youtube.readonly"],
};

const PUBLISH_SCOPES: Record<SocialPlatformKey, string> = {
  instagram: "instagram_business_content_publish",
  tiktok: "video.publish",
  youtube: "https://www.googleapis.com/auth/youtube.upload",
};

type NormalizedProfile = {
  externalAccountId: string;
  displayName: string | null;
  username: string | null;
  profileUrl: string | null;
  imageUrl: string | null;
  raw: Json;
};

type NormalizedToken = {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  expiresAt: string | null;
  refreshExpiresAt: string | null;
  grantedScopes: string[];
};

type InstagramTokenResponse = {
  access_token: string;
  user_id?: string | number;
  permissions?: string[];
  expires_in?: number;
};

type TikTokTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  open_id?: string;
  token_type?: string;
};

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

function serviceSupabase() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for social connection token storage.");
  }
  return createSupabaseClient<SocialDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function socialEnv(platform: SocialPlatformKey) {
  if (platform === "instagram") {
    const clientId = process.env.INSTAGRAM_APP_ID?.trim();
    const clientSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error("Instagram OAuth environment variables are missing.");
    return { clientId, clientSecret };
  }
  if (platform === "tiktok") {
    const clientId = process.env.TIKTOK_CLIENT_KEY?.trim();
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error("TikTok OAuth environment variables are missing.");
    return { clientId, clientSecret };
  }
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("YouTube OAuth environment variables are missing.");
  return { clientId, clientSecret };
}

function redirectUri(platform: SocialPlatformKey, origin: string) {
  const explicit =
    platform === "instagram"
      ? process.env.INSTAGRAM_REDIRECT_URI?.trim()
      : platform === "tiktok"
        ? process.env.TIKTOK_REDIRECT_URI?.trim()
        : process.env.YOUTUBE_REDIRECT_URI?.trim();
  return explicit || `${origin.replace(/\/$/, "")}/studio/settings/social/${platform}/callback`;
}

function requestedScopes(platform: SocialPlatformKey) {
  const scopes = [...BASE_SCOPES[platform]];
  if (process.env.ATLAS_SOCIAL_REQUEST_PUBLISH_SCOPES?.trim().toLowerCase() === "true") {
    scopes.push(PUBLISH_SCOPES[platform]);
  }
  return scopes;
}

function splitScopes(scope: string | null | undefined) {
  if (!scope) return [];
  return scope.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
}

function expiryFromNow(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function randomState() {
  return randomBytes(32).toString("base64url");
}

async function jsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json() as Record<string, unknown>;
      detail = String(body.error_description ?? body.error_message ?? body.message ?? body.error ?? "");
    } catch {
      // Ignore non-JSON provider error responses.
    }
    throw new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return await response.json() as T;
}

export function hasSocialPlatformEnv(platform: SocialPlatformKey) {
  return SOCIAL_PLATFORM_DEFINITIONS[platform].envVars.every((key) => Boolean(process.env[key]?.trim()));
}

export function createSocialAuthorizeUrl(platform: SocialPlatformKey, origin: string) {
  const { clientId } = socialEnv(platform);
  const state = randomState();
  const callback = redirectUri(platform, origin);
  const scopes = requestedScopes(platform);

  if (platform === "instagram") {
    const url = new URL(INSTAGRAM_AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return { url, state };
  }

  if (platform === "tiktok") {
    const url = new URL(TIKTOK_AUTHORIZE_URL);
    url.searchParams.set("client_key", clientId);
    url.searchParams.set("redirect_uri", callback);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return { url, state };
  }

  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return { url, state };
}

async function exchangeInstagramCode(code: string, origin: string): Promise<NormalizedToken> {
  const { clientId, clientSecret } = socialEnv("instagram");
  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("instagram", origin),
      code,
    }),
    cache: "no-store",
  });
  const shortToken = await jsonResponse<InstagramTokenResponse>(response, "Instagram token exchange");
  let accessToken = shortToken.access_token;
  let expiresIn = shortToken.expires_in;

  const longLivedUrl = new URL(`${INSTAGRAM_GRAPH_URL}/access_token`);
  longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
  longLivedUrl.searchParams.set("client_secret", clientSecret);
  longLivedUrl.searchParams.set("access_token", accessToken);
  const longLivedResponse = await fetch(longLivedUrl, { cache: "no-store" });
  if (longLivedResponse.ok) {
    const longLived = await longLivedResponse.json() as { access_token?: string; expires_in?: number };
    accessToken = longLived.access_token || accessToken;
    expiresIn = longLived.expires_in || expiresIn;
  }

  const grantedScopes = shortToken.permissions?.length
    ? shortToken.permissions
    : requestedScopes("instagram");
  return {
    accessToken,
    refreshToken: null,
    scope: grantedScopes.join(" "),
    expiresAt: expiryFromNow(expiresIn),
    refreshExpiresAt: null,
    grantedScopes,
  };
}

async function exchangeTikTokCode(code: string, origin: string): Promise<NormalizedToken> {
  const { clientId, clientSecret } = socialEnv("tiktok");
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("tiktok", origin),
    }),
    cache: "no-store",
  });
  const token = await jsonResponse<TikTokTokenResponse>(response, "TikTok token exchange");
  const grantedScopes = splitScopes(token.scope);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scope: token.scope ?? null,
    expiresAt: expiryFromNow(token.expires_in),
    refreshExpiresAt: expiryFromNow(token.refresh_expires_in),
    grantedScopes,
  };
}

async function exchangeYouTubeCode(code: string, origin: string): Promise<NormalizedToken> {
  const { clientId, clientSecret } = socialEnv("youtube");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri("youtube", origin),
    }),
    cache: "no-store",
  });
  const token = await jsonResponse<GoogleTokenResponse>(response, "YouTube token exchange");
  const grantedScopes = splitScopes(token.scope);
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scope: token.scope ?? null,
    expiresAt: expiryFromNow(token.expires_in),
    refreshExpiresAt: null,
    grantedScopes,
  };
}

async function fetchInstagramProfile(accessToken: string): Promise<NormalizedProfile> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/me`);
  url.searchParams.set("fields", "id,user_id,username,name,profile_picture_url");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store" });
  const profile = await jsonResponse<{
    id?: string;
    user_id?: string | number;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  }>(response, "Instagram profile request");
  const externalAccountId = String(profile.user_id ?? profile.id ?? "");
  if (!externalAccountId) throw new Error("Instagram profile did not contain an account ID.");
  return {
    externalAccountId,
    displayName: profile.name ?? profile.username ?? null,
    username: profile.username ?? null,
    profileUrl: profile.username ? `https://www.instagram.com/${profile.username}/` : null,
    imageUrl: profile.profile_picture_url ?? null,
    raw: profile as Json,
  };
}

async function fetchTikTokProfile(accessToken: string): Promise<NormalizedProfile> {
  const url = new URL(`${TIKTOK_API_URL}/user/info/`);
  url.searchParams.set("fields", "open_id,union_id,avatar_url,display_name");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await jsonResponse<{
    data?: { user?: { open_id?: string; union_id?: string; avatar_url?: string; display_name?: string } };
    error?: { code?: string; message?: string };
  }>(response, "TikTok profile request");
  const profile = payload.data?.user;
  const externalAccountId = profile?.open_id ?? profile?.union_id ?? "";
  if (!externalAccountId) throw new Error("TikTok profile did not contain an account ID.");
  return {
    externalAccountId,
    displayName: profile?.display_name ?? null,
    username: null,
    profileUrl: null,
    imageUrl: profile?.avatar_url ?? null,
    raw: payload as Json,
  };
}

async function fetchYouTubeProfile(accessToken: string): Promise<NormalizedProfile> {
  const url = new URL(`${YOUTUBE_API_URL}/channels`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await jsonResponse<{
    items?: Array<{
      id?: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
      };
    }>;
  }>(response, "YouTube channel request");
  const channel = payload.items?.[0];
  if (!channel?.id) throw new Error("YouTube did not return a channel for this account.");
  return {
    externalAccountId: channel.id,
    displayName: channel.snippet?.title ?? null,
    username: channel.snippet?.customUrl ?? null,
    profileUrl: `https://www.youtube.com/channel/${channel.id}`,
    imageUrl: channel.snippet?.thumbnails?.medium?.url ?? channel.snippet?.thumbnails?.default?.url ?? null,
    raw: payload as Json,
  };
}

async function storeSocialToken(ownerId: string, platform: SocialPlatformKey, token: NormalizedToken) {
  const { error } = await serviceSupabase().rpc("upsert_social_channel_token", {
    p_owner_id: ownerId,
    p_platform: platform,
    p_access_token: token.accessToken,
    p_refresh_token: token.refreshToken,
    p_scope: token.scope,
    p_expires_at: token.expiresAt,
    p_refresh_expires_at: token.refreshExpiresAt,
  });
  if (error) throw new Error(error.message);
}

export async function completeSocialOAuth({
  ownerId,
  platform,
  code,
  origin,
}: {
  ownerId: string;
  platform: SocialPlatformKey;
  code: string;
  origin: string;
}) {
  const token =
    platform === "instagram"
      ? await exchangeInstagramCode(code, origin)
      : platform === "tiktok"
        ? await exchangeTikTokCode(code, origin)
        : await exchangeYouTubeCode(code, origin);

  const profile =
    platform === "instagram"
      ? await fetchInstagramProfile(token.accessToken)
      : platform === "tiktok"
        ? await fetchTikTokProfile(token.accessToken)
        : await fetchYouTubeProfile(token.accessToken);

  await storeSocialToken(ownerId, platform, token);
  const publishScope = PUBLISH_SCOPES[platform];
  const canPublish = token.grantedScopes.includes(publishScope);
  const now = new Date().toISOString();
  const { error } = await serviceSupabase()
    .from("social_channel_accounts")
    .upsert(
      {
        owner_id: ownerId,
        platform,
        external_account_id: profile.externalAccountId,
        display_name: profile.displayName,
        username: profile.username,
        profile_url: profile.profileUrl,
        image_url: profile.imageUrl,
        status: "connected",
        granted_scopes: token.grantedScopes,
        can_publish: canPublish,
        raw_profile: profile.raw,
        connected_at: now,
        last_verified_at: now,
      },
      { onConflict: "owner_id,platform" },
    );
  if (error) throw new Error(error.message);

  return { profile, canPublish, grantedScopes: token.grantedScopes };
}

export async function disconnectSocialPlatform(ownerId: string, platform: SocialPlatformKey) {
  const supabase = serviceSupabase();
  const { error: tokenError } = await supabase.rpc("delete_social_channel_token", {
    p_owner_id: ownerId,
    p_platform: platform,
  });
  if (tokenError) throw new Error(tokenError.message);
  const { error } = await supabase
    .from("social_channel_accounts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("platform", platform);
  if (error) throw new Error(error.message);
}
