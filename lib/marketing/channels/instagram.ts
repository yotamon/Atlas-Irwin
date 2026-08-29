import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialOwnerForExternalPost } from "../social-auth";
import type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, PublishRequest, PublishResult } from "../channel-types";
import { captionFor, isVideoRequest, jsonOrThrow } from "../channel-utils";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || "v25.0";

function instagramUrl(path: string) {
  return `${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}${path}`;
}

export class InstagramChannelAdapter implements MarketingChannelAdapter {
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
        const status = await jsonOrThrow<{ status_code?: string; status?: string }>(
          await fetch(statusUrl, { cache: "no-store" }),
          "Instagram container status",
        );
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

    const publishResponse = await fetch(instagramUrl(`/${access.externalAccountId}/media_publish`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ creation_id: created.id, access_token: access.accessToken }),
      cache: "no-store",
    });
    const published = await jsonOrThrow<{ id?: string }>(publishResponse, "Instagram publish");
    if (!published.id) throw new Error("Instagram did not return a published media ID.");

    const permalinkUrl = new URL(instagramUrl(`/${published.id}`));
    permalinkUrl.searchParams.set("fields", "permalink");
    permalinkUrl.searchParams.set("access_token", access.accessToken);
    const permalinkResponse = await fetch(permalinkUrl, { cache: "no-store" });
    const permalink = permalinkResponse.ok ? await permalinkResponse.json() as { permalink?: string } : {};
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
    const media = await jsonOrThrow<{ media_type?: string; like_count?: number; comments_count?: number }>(
      await fetch(mediaUrl, { cache: "no-store" }),
      "Instagram media metrics",
    );

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
      const payload = await response.json() as { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> };
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
