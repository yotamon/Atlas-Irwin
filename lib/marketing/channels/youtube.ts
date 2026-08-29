import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialOwnerForExternalPost } from "../social-auth";
import type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, PublishRequest, PublishResult } from "../channel-types";
import { captionFor, isVideoRequest, jsonOrThrow, readAsset } from "../channel-utils";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

function youtubeTitle(request: PublishRequest) {
  const source = request.hookText || request.caption?.split("\n")[0] || "Atlas Irwin";
  return source.trim().slice(0, 100) || "Atlas Irwin";
}

export class YouTubeChannelAdapter implements MarketingChannelAdapter {
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
