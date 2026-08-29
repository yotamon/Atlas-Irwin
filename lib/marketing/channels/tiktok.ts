import "server-only";

import type { Json } from "@/types/database";
import { requireSocialAccess, socialOwnerForExternalPost } from "../social-auth";
import type { ChannelCapability, ChannelMetrics, MarketingChannelAdapter, PublishRequest, PublishResult } from "../channel-types";
import { captionFor, isVideoRequest, jsonOrThrow, readAsset, record, truthyEnv, type SocialAsset } from "../channel-utils";

const TIKTOK_API_URL = "https://open.tiktokapis.com/v2";
const TIKTOK_CHUNK_BYTES = 10 * 1024 * 1024;

async function tiktokJson<T>(response: Response, label: string): Promise<T> {
  const payload = await jsonOrThrow<Record<string, unknown>>(response, label);
  const error = record(payload.error);
  if (error.code && error.code !== "ok" && error.code !== 0) {
    throw new Error(`${label} failed: ${String(error.message || error.code)}.`);
  }
  return payload as T;
}

export function tiktokUploadPlan(size: number) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("TikTok publishing requires a non-empty video asset.");
  const chunkSize = Math.min(size, TIKTOK_CHUNK_BYTES);
  const totalChunks = Math.max(1, Math.floor(size / chunkSize));
  return { chunkSize, totalChunks };
}

async function uploadTikTokBytes(uploadUrl: string, asset: SocialAsset, chunkSize: number, totalChunks: number) {
  const size = asset.bytes.length;
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * chunkSize;
    const isFinalChunk = index === totalChunks - 1;
    const endExclusive = isFinalChunk ? size : start + chunkSize;
    const chunk = asset.bytes.subarray(start, endExclusive);
    const uploadBody = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": asset.contentType.startsWith("video/") ? asset.contentType : "video/mp4",
        "content-length": String(chunk.length),
        "content-range": `bytes ${start}-${endExclusive - 1}/${size}`,
      },
      body: uploadBody,
    });
    if (!response.ok) throw new Error(`TikTok media upload failed (${response.status}).`);
  }
}

export class TikTokChannelAdapter implements MarketingChannelAdapter {
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
      const creator = await tiktokJson<{ data?: { privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean } }>(
        await fetch(`${TIKTOK_API_URL}/post/publish/creator_info/query/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
          body: "{}",
          cache: "no-store",
        }),
        "TikTok creator info",
      );
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

    const initialized = await tiktokJson<{ data?: { publish_id?: string; upload_url?: string } }>(
      await fetch(endpoint, {
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
      }),
      audited ? "TikTok Direct Post init" : "TikTok draft upload init",
    );
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
      const status = await tiktokJson<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> } }>(
        await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ publish_id: initialized.data.publish_id }),
          cache: "no-store",
        }),
        "TikTok publish status",
      );
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
      const status = await tiktokJson<{ data?: { publicaly_available_post_id?: Array<string | number> } }>(
        await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ publish_id: publishId }),
          cache: "no-store",
        }),
        "TikTok publish status",
      );
      const available = status.data?.publicaly_available_post_id?.[0];
      if (!available) return null;
      postId = String(available);
    }

    const url = new URL(`${TIKTOK_API_URL}/video/query/`);
    url.searchParams.set("fields", "id,share_url,like_count,comment_count,share_count,view_count");
    const payload = await tiktokJson<{ data?: { videos?: Array<{ like_count?: number; comment_count?: number; share_count?: number; view_count?: number }> } }>(
      await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: [postId] } }),
        cache: "no-store",
      }),
      "TikTok video metrics",
    );
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
