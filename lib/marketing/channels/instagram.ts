import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialContextForExternalPost } from "../social-auth";
import type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, PublishRequest, PublishResult } from "../channel-types";
import { captionFor, isVideoRequest, jsonOrThrow, record } from "../channel-utils";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || "v25.0";

function instagramUrl(path: string) {
  return `${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}${path}`;
}

function format(request: PublishRequest) {
  const value = record(request.metadata).format;
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function assetUrls(request: PublishRequest) {
  const metadata = record(request.metadata);
  const values = Array.isArray(metadata.assetUrls)
    ? metadata.assetUrls.filter((value): value is string => typeof value === "string" && /^https:\/\//i.test(value))
    : [];
  if (values.length) return Array.from(new Set(values)).slice(0, 10);
  return request.assetUrl && /^https:\/\//i.test(request.assetUrl) ? [request.assetUrl] : [];
}

async function createContainer(accountId: string, accessToken: string, params: URLSearchParams, label: string) {
  params.set("access_token", accessToken);
  const response = await fetch(instagramUrl(`/${accountId}/media`), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const created = await jsonOrThrow<{ id?: string }>(response, label);
  if (!created.id) throw new Error(`${label} did not return a media container ID.`);
  return created.id;
}

async function waitForContainer(containerId: string, accessToken: string) {
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const statusUrl = new URL(instagramUrl(`/${containerId}`));
    statusUrl.searchParams.set("fields", "status_code,status");
    statusUrl.searchParams.set("access_token", accessToken);
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

async function publishContainer(accountId: string, accessToken: string, containerId: string) {
  const publishResponse = await fetch(instagramUrl(`/${accountId}/media_publish`), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: containerId, access_token: accessToken }),
    cache: "no-store",
  });
  const published = await jsonOrThrow<{ id?: string }>(publishResponse, "Instagram publish");
  if (!published.id) throw new Error("Instagram did not return a published media ID.");
  return published.id;
}

async function permalink(externalPostId: string, accessToken: string) {
  const url = new URL(instagramUrl(`/${externalPostId}`));
  url.searchParams.set("fields", "permalink");
  url.searchParams.set("access_token", accessToken);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return undefined;
  const payload = await response.json() as { permalink?: string };
  return payload.permalink;
}

async function publishCarousel(request: PublishRequest, access: Awaited<ReturnType<typeof requireSocialAccess>>): Promise<PublishResult> {
  const urls = assetUrls(request);
  if (urls.length < 2) throw new Error("Instagram carousel publishing requires at least two public image URLs.");
  const childIds: string[] = [];
  for (const url of urls) {
    const childId = await createContainer(
      access.externalAccountId,
      access.accessToken,
      new URLSearchParams({ image_url: url, is_carousel_item: "true" }),
      "Instagram carousel child creation",
    );
    childIds.push(childId);
  }
  const parentParams = new URLSearchParams({
    media_type: "CAROUSEL",
    children: childIds.join(","),
  });
  const caption = captionFor(request);
  if (caption) parentParams.set("caption", caption);
  const parentId = await createContainer(access.externalAccountId, access.accessToken, parentParams, "Instagram carousel creation");
  const publishedId = await publishContainer(access.externalAccountId, access.accessToken, parentId);
  return {
    status: "published",
    externalPostId: publishedId,
    externalUrl: await permalink(publishedId, access.accessToken),
    details: { adapter: "instagram:first-party", kind: "carousel", containerId: parentId, childContainerIds: childIds } as Json,
  };
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
    if (!request.assetUrl && !assetUrls(request).length) throw new Error("Instagram publishing requires attached media.");
    const access = await requireSocialAccess(request.ownerId, request.artistId, "instagram", ["instagram_business_content_publish"]);
    const nativeFormat = format(request);
    if (nativeFormat.includes("carousel") || assetUrls(request).length > 1) return publishCarousel(request, access);

    const isStory = nativeFormat.includes("story");
    const params = new URLSearchParams();
    const caption = captionFor(request);
    if (caption && !isStory) params.set("caption", caption);
    if (isVideoRequest(request)) {
      params.set("media_type", isStory ? "STORIES" : "REELS");
      params.set("video_url", request.assetUrl!);
      if (!isStory) params.set("share_to_feed", "true");
    } else {
      params.set("image_url", request.assetUrl!);
      if (isStory) params.set("media_type", "STORIES");
    }

    const containerId = await createContainer(
      access.externalAccountId,
      access.accessToken,
      params,
      isStory ? "Instagram Story container creation" : "Instagram media container creation",
    );
    if (isVideoRequest(request)) await waitForContainer(containerId, access.accessToken);
    const publishedId = await publishContainer(access.externalAccountId, access.accessToken, containerId);
    return {
      status: "published",
      externalPostId: publishedId,
      externalUrl: isStory ? undefined : await permalink(publishedId, access.accessToken),
      details: { adapter: "instagram:first-party", kind: isStory ? "story" : isVideoRequest(request) ? "reel" : "image", containerId } as Json,
    };
  }

  async fetchMetrics(externalPostId: string): Promise<ChannelMetrics | null> {
    const context = await socialContextForExternalPost("Instagram", externalPostId);
    if (!context) return null;
    const access = await requireSocialAccess(context.ownerId, context.artistId, "instagram", ["instagram_business_manage_insights"]);

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
