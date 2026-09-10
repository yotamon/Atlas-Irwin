import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import type { ArtistScopedSocialDatabase } from "@/types/artist-scoped-operational-database";
import type { SocialPlatformKey } from "./social-platforms";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REFRESH_EARLY_MS = 5 * 60 * 1000;

export type SocialAccess = {
  ownerId: string;
  artistId: string;
  platform: SocialPlatformKey;
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
  grantedScopes: string[];
  expiresAt: string | null;
  externalAccountId: string;
  username: string | null;
};

export type SocialPublicationContext = {
  ownerId: string;
  artistId: string;
};

type TokenRow = {
  access_token: string;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
};

function serviceSupabase() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for social publishing.");
  return createSupabaseClient<ArtistScopedSocialDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function splitScopes(scope: string | null | undefined) {
  return (scope || "").split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
}

function expiresSoon(value: string | null) {
  if (!value) return false;
  return new Date(value).getTime() <= Date.now() + REFRESH_EARLY_MS;
}

function expiryFromNow(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function providerError(response: Response, label: string) {
  let detail = "";
  try {
    const body = await response.json() as Record<string, unknown>;
    detail = String(body.error_description ?? body.error_message ?? body.message ?? body.error ?? "");
  } catch {
    detail = (await response.text().catch(() => "")).slice(0, 600);
  }
  return new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ""}.`);
}

async function readToken(ownerId: string, artistId: string, platform: SocialPlatformKey) {
  const { data, error } = await serviceSupabase().rpc("get_social_channel_token_for_artist", {
    p_owner_id: ownerId,
    p_artist_id: artistId,
    p_platform: platform,
  });
  if (error) throw new Error(error.message);
  return (data?.[0] ?? null) as TokenRow | null;
}

async function writeToken(ownerId: string, artistId: string, platform: SocialPlatformKey, token: TokenRow) {
  const { error } = await serviceSupabase().rpc("upsert_social_channel_token_for_artist", {
    p_owner_id: ownerId,
    p_artist_id: artistId,
    p_platform: platform,
    p_access_token: token.access_token,
    p_refresh_token: token.refresh_token,
    p_scope: token.scope,
    p_expires_at: token.expires_at,
    p_refresh_expires_at: token.refresh_expires_at,
  });
  if (error) throw new Error(error.message);
}

async function refreshInstagram(token: TokenRow): Promise<TokenRow> {
  const url = new URL(`${INSTAGRAM_GRAPH_URL}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token.access_token);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw await providerError(response, "Instagram token refresh");
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Instagram token refresh returned no access token.");
  return {
    ...token,
    access_token: body.access_token,
    expires_at: expiryFromNow(body.expires_in),
  };
}

async function refreshTikTok(token: TokenRow): Promise<TokenRow> {
  if (!token.refresh_token) throw new Error("TikTok connection needs reauthorization because no refresh token is stored.");
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) throw new Error("TikTok OAuth environment variables are missing.");
  const response = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw await providerError(response, "TikTok token refresh");
  const body = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_expires_in?: number;
    scope?: string;
  };
  if (!body.access_token) throw new Error("TikTok token refresh returned no access token.");
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? token.refresh_token,
    scope: body.scope ?? token.scope,
    expires_at: expiryFromNow(body.expires_in),
    refresh_expires_at: expiryFromNow(body.refresh_expires_in) ?? token.refresh_expires_at,
  };
}

async function refreshYouTube(token: TokenRow): Promise<TokenRow> {
  if (!token.refresh_token) throw new Error("YouTube connection needs reauthorization because no refresh token is stored.");
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("YouTube OAuth environment variables are missing.");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw await providerError(response, "YouTube token refresh");
  const body = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
  if (!body.access_token) throw new Error("YouTube token refresh returned no access token.");
  return {
    ...token,
    access_token: body.access_token,
    scope: body.scope ?? token.scope,
    expires_at: expiryFromNow(body.expires_in),
  };
}

async function refreshedToken(ownerId: string, artistId: string, platform: SocialPlatformKey, token: TokenRow) {
  if (!expiresSoon(token.expires_at)) return token;
  const next = platform === "instagram"
    ? await refreshInstagram(token)
    : platform === "tiktok"
      ? await refreshTikTok(token)
      : await refreshYouTube(token);
  await writeToken(ownerId, artistId, platform, next);
  return next;
}

export async function requireSocialAccess(
  ownerId: string,
  artistId: string,
  platform: SocialPlatformKey,
  requiredScopes: string[] = [],
): Promise<SocialAccess> {
  if (!ownerId || !artistId) throw new Error("Social access requires explicit owner and artist context.");
  const supabase = serviceSupabase();
  const { data: account, error: accountError } = await supabase
    .from("social_channel_accounts")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("platform", platform)
    .maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account || account.status !== "connected") {
    throw new Error(`${platform} is not connected for this artist. Reconnect it in Studio Settings.`);
  }

  const stored = await readToken(ownerId, artistId, platform);
  if (!stored) throw new Error(`${platform} is connected for this artist without a usable token. Reconnect it in Studio Settings.`);

  let token: TokenRow;
  try {
    token = await refreshedToken(ownerId, artistId, platform, stored);
  } catch (error) {
    await supabase
      .from("social_channel_accounts")
      .update({ status: "needs_reauth" })
      .eq("owner_id", ownerId)
      .eq("artist_id", artistId)
      .eq("platform", platform);
    throw error;
  }

  const grantedScopes = Array.from(new Set([
    ...account.granted_scopes,
    ...splitScopes(token.scope),
  ]));
  const missing = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missing.length) {
    throw new Error(`${platform} needs additional permissions (${missing.join(", ")}). Reconnect it in Studio Settings.`);
  }

  return {
    ownerId,
    artistId,
    platform,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    scope: token.scope,
    grantedScopes,
    expiresAt: token.expires_at,
    externalAccountId: account.external_account_id,
    username: account.username,
  };
}

export async function socialContextForExternalPost(platform: string, externalPostId: string): Promise<SocialPublicationContext | null> {
  const { createMarketingServiceClient } = await import("./db");
  const client = createMarketingServiceClient();
  const { data, error } = await client
    .from("publication_jobs")
    .select("owner_id,artist_id")
    .eq("platform", platform)
    .eq("external_post_id", externalPostId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ownerId: data.owner_id, artistId: data.artist_id } : null;
}

export async function socialOwnerForExternalPost(platform: string, externalPostId: string) {
  const context = await socialContextForExternalPost(platform, externalPostId);
  return context?.ownerId ?? null;
}
