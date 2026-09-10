import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialContextForExternalPost } from "../social-auth";
import type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, ProviderPublicationStatus, PublishRequest, PublishResult } from "../channel-types";
import { captionFor, isVideoRequest, jsonOrThrow, readAsset } from "../channel-utils";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

function youtubeTitle(request: PublishRequest) {
  const source = request.hookText || request.caption?.split("\n")[0] || "Atlas Irwin";
  return source.trim().slice(0, 100) || "Atlas Irwin";
}

function providerScheduledAt(request: PublishRequest) {
  if (!request.scheduledAt) return null;
  const timestamp = new Date(request.scheduledAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= Date.now() + 60_000) return null;
  return new Date(timestamp).toISOString();
}

export class YouTubeChannelAdapter implements MarketingChannelAdapter {
  capability(): ChannelCapability {
    const configured = Boolean(process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() && process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim());
    return {
      id: "youtube:first-party",
      label: "YouTube Data API",
      automatedPublishing: configured,
      automatedMetrics: configured,
      providerScheduling: configured,
      reason: configured ? undefined : "YouTube OAuth environment variables are not configured.",
    };
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (!request.assetUrl || !isVideoRequest(request)) throw new Error("YouTube Shorts publishing requires an attached video asset.");
    const access = await requireSocialAccess(request.ownerId, request.artistId, "youtube", [YOUTUBE_UPLOAD_SCOPE]);
    const asset = await readAsset(request.assetUrl);
    const boundary = `atlas_${crypto.randomUUID().replaceAll("-", "")}`;
    const scheduledAt = providerScheduledAt(request);
    const metadata = Buffer.from(JSON.stringify({
      snippet: {
        title: youtubeTitle(request),
        description: captionFor(request).slice(0, 5000),
        categoryId: process.env.YOUTUBE_CATEGORY_ID?.trim() || "10",
      },
      status: {
        privacyStatus: scheduledAt ? "private" : process.env.YOUTUBE_DEFAULT_PRIVACY?.trim() || "public",
        ...(scheduledAt ? { publishAt: scheduledAt } : {}),
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
      status: scheduledAt ? "provider_scheduled" : "published",
      externalPostId: video.id,
      externalUrl: `https://www.youtube.com/watch?v=${video.id}`,
      details: {
        adapter: "youtube:first-party",
        ...(scheduledAt ? { providerScheduledAt: scheduledAt, privacyStatus: "private" } : {}),
      } as Json,
    };
  }

  async fetchPublicationStatus(ownerId: string, externalPostId: string): Promise<ProviderPublicationStatus> {
    const context = await socialContextForExternalPost("YouTube Shorts", externalPostId);
    if (!context || context.ownerId !== ownerId) {
      throw new Error("YouTube publication context is missing or does not match the expected owner.");
    }
    const access = await requireSocialAccess(context.ownerId, context.artistId, "youtube", [YOUTUBE_READ_SCOPE]);
    const url = new URL(`${YOUTUBE_API_URL}/videos`);
    url.searchParams.set("part", "status,processingDetails");
    url.searchParams.set("id", externalPostId);
    const payload = await jsonOrThrow<{
      items?: Array<{
        status?: {
          privacyStatus?: string;
          uploadStatus?: string;
          failureReason?: string;
          rejectionReason?: string;
          publishAt?: string;
        };
        processingDetails?: { processingStatus?: string };
      }>;
    }>(await fetch(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
      cache: "no-store",
    }), "YouTube publication status");
    const item = payload.items?.[0];
    if (!item) {
      return { status: "failed", details: { reason: "YouTube no longer returns the scheduled video." } as Json };
    }
    const uploadStatus = item.status?.uploadStatus || "";
    const processingStatus = item.processingDetails?.processingStatus || "";
    if (["failed", "rejected", "deleted"].includes(uploadStatus) || processingStatus === "failed") {
      return {
        status: "failed",
        details: {
          uploadStatus,
          processingStatus,
          failureReason: item.status?.failureReason,
          rejectionReason: item.status?.rejectionReason,
        } as Json,
      };
    }
    if (item.status?.privacyStatus === "public") {
      return { status: "published", publishedAt: new Date().toISOString(), details: { uploadStatus, processingStatus } as Json };
    }
    return {
      status: "scheduled",
      details: {
        privacyStatus: item.status?.privacyStatus,
        publishAt: item.status?.publishAt,
        uploadStatus,
        processingStatus,
      } as Json,
    };
  }

  async fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null> {
    const context = await socialContextForExternalPost("YouTube Shorts", externalPostId);
    if (!context) return null;
    const access = await requireSocialAccess(context.ownerId, context.artistId, "youtube", [YOUTUBE_READ_SCOPE]);
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
