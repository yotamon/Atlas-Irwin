import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialOwnerForExternalPost } from "./social-auth";
import { socialPlatformForPlannerPlatform, type SocialPlatformKey } from "./social-platforms";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || "v25.0";
const TIKTOK_API_URL = "https://open.tiktokapis.com/v2";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const MAX_SOCIAL_ASSET_BYTES = 256 * 1024 * 1024;
const TIKTOK_CHUNK_BYTES = 10 * 1024 * 1024;

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

type Asset = { bytes: Buffer; contentType: string };

function record(value: Json | unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function truthyEnv(name: string) {
  return ["1", "true", "yes", "on"].includes(process.env[name]?.trim().toLowerCase() || "");
}

function captionFor(request: PublishRequest) {
  return [request.caption, request.attributionUrl].filter(Boolean).join("\n\n").trim();
}

function isVideoRequest(request: PublishRequest) {
  const metadata = record(request.metadata);
  const mime = typeof metadata.mimeType === "string" ? metadata.mimeType : "";
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("image/")) return false;
  return /\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(request.assetUrl || "");
}

async function readAsset(url: string): Promise<Asset> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download social asset (${response.status}).`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_SOCIAL_ASSET_BYTES) throw new Error("Social asset is larger than Atlas's 256 MB automation limit.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOCIAL_ASSET_BYTES) throw new Error("Social asset is larger than Atlas's 256 MB automation limit.");
  return { bytes, contentType: response.headers.get("content-type")?.split(";")[0] || "application/octet-stream" };
}

async function jsonOrThrow<T>(response: Response, label: string): Promise<T> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = record(payload.error);
    const detail = String(error.message ?? payload.message ?? payload.error_description ?? "");
    throw new Error(`${label} failed (${response.status})${detail ? `: ${detail}` : ""}.`);
  }
  return payload as T;
}

function instagramUrl(path: string) {
  return `${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}${path}`;
}

class InstagramChannelAdapter implements MarketingChannelAdapter {
  capability(): ChannelCapability {
    const configured = Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim());
    return {
      id: "instagram:first-party",
      label: "Instagram first-party API",
      automatedPublishing: configured,
      automatedMetrics: configured,
      reason: configured ? undefined : "Instagram OAuth environment variables are not configured.",
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (!request.assetUrl) throw new Error("Instagram publishing requires an attached media asset.");
    const access = await requireSocialAccess(request.ownerId, "instagram", ["instagram_business_content_publish"]);
    const params = new URLSearchParams({ access_token: access.accessToken });
    const caption = captionFor(request);
    if (caption) params.set("caption", caption);
    if (isVideoRequest(request)) {
      params.set("media_type", "REELS");
      params.set("video_url", request.assetUrl);
      params.set("share_to_feed", "true");
    } else {
      params.set("image_url", request.assetUrl);
    }

    const createResponse = await fetch(instagramUrl(`/${access.externalAccountId}/media`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
      cache: "no-store",
    });
    const created = await jsonOrThrow<{ id?: string }>(createResponse, "Instagram media container creation");
    if (!created.id) throw new Error("Instagram did not return a media container ID.");

    if (isVideoRequest(request)) {
      let ready = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const statusUrl = new URL(instagramUrl(`/${created.id}`));
        statusUrl.searchParams.set("fields", "status_code,status");
        statusUrl.searchParams.set("access_token", access.accessToken);
        const statusResponse = await fetch(statusUrl, { cache: "no-store" });
        const status = await jsonOrThrow<{ status_code?: string; status?: string }>(statusResponse, "Instagram container status");
        if (status.status_code === "FINISHED") {
          ready = true;
          break;
        }
        if (["ERROR", "EXPIRED"].includes(status.status_code || "")) {
          throw new Error(`Instagram media processing failed: ${status.status || status.status_code}.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      if (!ready) throw new Error("Instagram media is still processing. Atlas will retry the publication job.");
    }

    const publishParams = new URLSearchParams({
      creation_id: created.id,
      access_token: access.accessToken,
    });
    const publishResponse = await fetch(instagramUrl(`/${access.externalAccountId}/media_publish`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishParams,
      cache: "no-store",
    });
    const published = await jsonOrThrow<{ id?: string }>(publishResponse, "Instagram publish");
    if (!published.id) throw new Error("Instagram did not return a published media ID.");

    const permalinkUrl = new URL(instagramUrl(`/${published.id}`));
    permalinkUrl.searchParams.set("fields", "permalink");
    permalinkUrl.searchParams.set("access_token", access.accessToken);
    const permalinkResponse = await fetch(permalinkUrl, { cache: "no-store" });
    const permalink = permalinkResponse.ok
      ? await permalinkResponse.json() as { permalink?: string }
      : {};
    return {
      status: "published",
      externalPostId: published.id,
      externalUrl: permalink.permalink,
      details: { adapter: "instagram:first-party", containerId: created.id } as Json,
    };
  }

  async fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null> {
    const ownerId = await socialOwnerForExternalPost("Instagram", externalPostId);
    if (!ownerId) return null;
    const access = await requireSocialAccess(ownerId, "instagram", ["instagram_business_manage_insights"]);

    const mediaUrl = new URL(instagramUrl(`/${externalPostId}`));
    mediaUrl.searchParams.set("fields", "media_type,like_count,comments_count");
    mediaUrl.searchParams.set("access_token", access.accessToken);
    const mediaResponse = await fetch(mediaUrl, { cache: "no-store" });
    const media = await jsonOrThrow<{ media_type?: string; like_count?: number; comments_count?: number }>(mediaResponse, "Instagram media metrics");

    const metricNames = media.media_type === "VIDEO" || media.media_type === "REELS"
      ? ["views", "reach", "saved", "shares", "total_interactions", "ig_reels_video_view_total_time"]
      : ["views", "reach", "saved", "shares", "total_interactions"];
    const values: Record<string, number> = {};
    await Promise.all(metricNames.map(async (metric) => {
      const url = new URL(instagramUrl(`/${externalPostId}/insights`));
      url.searchParams.set("metric", metric);
      url.searchParams.set("access_token", access.accessToken);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { data?: Array<{ name?: string; values?: Array<{ value?: number } }> };
      const value = Number(payload.data?.[0]?.values?.[0]?.value ?? 0);
      if (Number.isFinite(value)) values[metric] = value;
    }));

    return {
      views: Math.round(values.views || 0),
      reach: Math.round(values.reach || 0),
      likes: Math.round(Number(media.like_count) || 0),
      comments: Math.round(Number(media.comments_count) || 0),
      shares: Math.round(values.shares || 0),
      saves: Math.round(values.saved || 0),
      watch_time: Math.round((values.ig_reels_video_view_total_time || 0) / 1000),
    };
  }
}

async function tiktokJson<T>(response: Response, label: string): Promise<T> {
  const payload = await jsonOrThrow<Record<string, unknown>>(response, label);
  const error = record(payload.error);
  if (error.code && error.code !== "ok" && error.code !== 0) {
    throw new Error(`${label} failed: ${String(error.message || error.code)}.`);
  }
  return payload as T;
}

function tiktokUploadPlan(size: number) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("TikTok publishing requires a non-empty video asset.");
  const chunkSize = Math.min(size, TIKTOK_CHUNK_BYTES);
  const totalChunks = Math.max(1, Math.floor(size / chunkSize));
  return { chunkSize, totalChunks };
}

async function uploadTikTokBytes(uploadUrl: string, asset: Asset, chunkSize: number, totalChunks: number) {
  const size = asset.bytes.length;
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const isFinalChunk = index === totalChunks - 1;
    const endExclusive = isFinalChunk ? size : Math.min(size, start + chunkSize);
    const chunk = asset.bytes.subarray(start, endExclusive);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": asset.contentType.startsWith("video/") ? asset.contentType : "video/mp4",
        "content-length": String(chunk.length),
        "content-range": `bytes ${start}-${endExclusive - 1}/${size}`,
      },
      body: chunk,
    });
    if (!response.ok) throw new Error(`TikTok media upload failed (${response.status}).`);
  }
}

class TikTokChannelAdapter implements MarketingChannelAdapter {
  capability(): ChannelCapability {
    const configured = Boolean(process.env.TIKTOK_CLIENT_KEY?.trim() && process.env.TIKTOK_CLIENT_SECRET?.trim());
    const audited = truthyEnv("TIKTOK_DIRECT_POST_AUDITED");
    return {
      id: audited ? "tiktok:direct-post" : "tiktok:draft-upload",
      label: audited ? "TikTok Direct Post" : "TikTok draft upload",
      automatedPublishing: configured && audited,
      automatedMetrics: configured,
      reason: !configured
        ? "TikTok OAuth environment variables are not configured."
        : audited
          ? undefined
          : "TikTok Direct Post is intentionally disabled until the API client is audited; Atlas uploads a draft to the TikTok inbox instead.",
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (!request.assetUrl) throw new Error("TikTok publishing requires an attached video asset.");
    if (!isVideoRequest(request)) {
      return {
        status: "manual_handoff",
        details: { reason: "Atlas currently sends TikTok image posts through manual handoff because photo URLs must use a verified TikTok domain prefix." } as Json,
      };
    }
    const audited = truthyEnv("TIKTOK_DIRECT_POST_AUDITED");
    const scope = audited ? "video.publish" : "video.upload";
    const access = await requireSocialAccess(request.ownerId, "tiktok", [scope]);
    const asset = await readAsset(request.assetUrl);
    const { chunkSize, totalChunks } = tiktokUploadPlan(asset.bytes.length);
    const title = captionFor(request).slice(0, 2200);

    let endpoint = `${TIKTOK_API_URL}/post/publish/inbox/video/init/`;
    let postInfo: Record<string, unknown> | undefined;
    if (audited) {
      const creatorResponse = await fetch(`${TIKTOK_API_URL}/post/publish/creator_info/query/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: "{}",
        cache: "no-store",
      });
      const creator = await tiktokJson<{ data?: { privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean } }>(creatorResponse, "TikTok creator info");
      const options = creator.data?.privacy_level_options ?? [];
      const preferred = process.env.TIKTOK_DEFAULT_PRIVACY?.trim() || "PUBLIC_TO_EVERYONE";
      const privacy = options.includes(preferred) ? preferred : options[0];
      if (!privacy) throw new Error("TikTok did not return an available privacy level.");
      endpoint = `${TIKTOK_API_URL}/post/publish/video/init/`;
      postInfo = {
        title,
        privacy_level: privacy,
        disable_comment: Boolean(creator.data?.comment_disabled),
        disable_duet: Boolean(creator.data?.duet_disabled),
        disable_stitch: Boolean(creator.data?.stitch_disabled),
      };
    }

    const initResponse = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        ...(postInfo ? { post_info: postInfo } : {}),
        source_info: {
          source: "FILE_UPLOAD",
          video_size: asset.bytes.length,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks,
        },
      }),
      cache: "no-store",
    });
    const initialized = await tiktokJson<{ data?: { publish_id?: string; upload_url?: string } }>(initResponse, audited ? "TikTok Direct Post init" : "TikTok draft upload init");
    if (!initialized.data?.publish_id || !initialized.data.upload_url) throw new Error("TikTok did not return an upload URL and publish ID.");
    await uploadTikTokBytes(initialized.data.upload_url, asset, chunkSize, totalChunks);

    if (!audited) {
      return {
        status: "manual_handoff",
        details: {
          adapter: "tiktok:draft-upload",
          draftUploaded: true,
          publishId: initialized.data.publish_id,
          instruction: "Open the TikTok inbox notification to review and publish the prepared draft.",
        } as Json,
      };
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const statusResponse = await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: initialized.data.publish_id }),
        cache: "no-store",
      });
      const status = await tiktokJson<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> } }>(statusResponse, "TikTok publish status");
      if (status.data?.status === "FAILED") throw new Error(`TikTok publishing failed: ${status.data.fail_reason || "unknown reason"}.`);
      if (status.data?.status === "PUBLISH_COMPLETE") {
        const postId = status.data.publicaly_available_post_id?.[0];
        return {
          status: "published",
          externalPostId: postId ? String(postId) : `tiktok-publish:${initialized.data.publish_id}`,
          details: { adapter: "tiktok:direct-post", publishId: initialized.data.publish_id } as Json,
        };
      }
    }
    throw new Error("TikTok is still processing the post. Atlas will retry the publication job.");
  }

  async fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null> {
    const ownerId = await socialOwnerForExternalPost("TikTok", externalPostId);
    if (!ownerId) return null;
    const access = await requireSocialAccess(ownerId, "tiktok", ["video.list"]);
    let postId = externalPostId;
    if (externalPostId.startsWith("tiktok-publish:")) {
      const publishId = externalPostId.slice("tiktok-publish:".length);
      const statusResponse = await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ publish_id: publishId }),
        cache: "no-store",
      });
      const status = await tiktokJson<{ data?: { publicaly_available_post_id?: Array<string | number> } }>(statusResponse, "TikTok publish status");
      const available = status.data?.publicaly_available_post_id?.[0];
      if (!available) return null;
      postId = String(available);
    }

    const url = new URL(`${TIKTOK_API_URL}/video/query/`);
    url.searchParams.set("fields", "id,share_url,like_count,comment_count,share_count,view_count");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ filters: { video_ids: [postId] } }),
      cache: "no-store",
    });
    const payload = await tiktokJson<{ data?: { videos?: Array<{ like_count?: number; comment_count?: number; share_count?: number; view_count?: number }> } }>(response, "TikTok video metrics");
    const video = payload.data?.videos?.[0];
    if (!video) return null;
    return {
      views: Math.round(Number(video.view_count) || 0),
      reach: Math.round(Number(video.view_count) || 0),
      likes: Math.round(Number(video.like_count) || 0),
      comments: Math.round(Number(video.comment_count) || 0),
      shares: Math.round(Number(video.share_count) || 0),
    };
  }
}

function youtubeTitle(request: PublishRequest) {
  const source = request.hookText || request.caption?.split("\n")[0] || "Atlas Irwin";
  return source.trim().slice(0, 100) || "Atlas Irwin";
}

class YouTubeChannelAdapter implements MarketingChannelAdapter {
  capability(): ChannelCapability {
    const configured = Boolean(process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() && process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim());
    return {
      id: "youtube:first-party",
      label: "YouTube Data API",
      automatedPublishing: configured,
      automatedMetrics: configured,
      reason: configured ? undefined : "YouTube OAuth environment variables are not configured.",
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (!request.assetUrl || !isVideoRequest(request)) throw new Error("YouTube Shorts publishing requires an attached video asset.");
    const access = await requireSocialAccess(request.ownerId, "youtube", ["https://www.googleapis.com/auth/youtube.upload"]);
    const asset = await readAsset(request.assetUrl);
    const boundary = `atlas_${crypto.randomUUID().replaceAll("-", "")}`;
    const metadata = Buffer.from(JSON.stringify({
      snippet: {
        title: youtubeTitle(request),
        description: captionFor(request).slice(0, 5000),
        categoryId: process.env.YOUTUBE_CATEGORY_ID?.trim() || "10",
      },
      status: {
        privacyStatus: process.env.YOUTUBE_DEFAULT_PRIVACY?.trim() || "public",
        selfDeclaredMadeForKids: false,
      },
    }));
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata.toString("utf8")}\r\n` +
      `--${boundary}\r\nContent-Type: ${asset.contentType.startsWith("video/") ? asset.contentType : "video/mp4"}\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([prefix, asset.bytes, suffix]);
    const url = new URL(YOUTUBE_UPLOAD_URL);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("notifySubscribers", "false");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access.accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(body.length),
      },
      body,
      cache: "no-store",
    });
    const video = await jsonOrThrow<{ id?: string }>(response, "YouTube upload");
    if (!video.id) throw new Error("YouTube did not return a video ID.");
    return {
      status: "published",
      externalPostId: video.id,
      externalUrl: `https://www.youtube.com/watch?v=${video.id}`,
      details: { adapter: "youtube:first-party" } as Json,
    };
  }

  async fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null> {
    const ownerId = await socialOwnerForExternalPost("YouTube Shorts", externalPostId);
    if (!ownerId) return null;
    const access = await requireSocialAccess(ownerId, "youtube", ["https://www.googleapis.com/auth/youtube.readonly"]);
    const url = new URL(`${YOUTUBE_API_URL}/videos`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", externalPostId);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
      cache: "no-store",
    });
    const payload = await jsonOrThrow<{ items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }>(response, "YouTube video metrics");
    const statistics = payload.items?.[0]?.statistics;
    if (!statistics) return null;
    const views = Math.round(Number(statistics.viewCount) || 0);
    return {
      views,
      reach: views,
      likes: Math.round(Number(statistics.likeCount) || 0),
      comments: Math.round(Number(statistics.commentCount) || 0),
    };
  }
}

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