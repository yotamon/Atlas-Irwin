import "server-only";

import { runAtlasAiTask } from "@/lib/ai/control-plane";
import { createAutonomyServiceClient } from "./autonomy-db";
import { createMarketingServiceClient } from "./db";
import { requireSocialAccess } from "./social-auth";
import type { Json } from "@/types/database";
import type { AudienceInteraction } from "@/types/autonomy-database";

const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com";
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || "v25.0";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const AUDIENCE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MAX_POSTS_PER_PLATFORM = 8;
const MAX_REPLY_DRAFTS_PER_CYCLE = 5;

export type AudienceArtistScope = {
  ownerId: string;
  artistId: string;
};

function instagramUrl(path: string) {
  return `${INSTAGRAM_GRAPH_URL}/${INSTAGRAM_API_VERSION}${path}`;
}

function asJson(value: unknown) {
  return value as Json;
}

function looksLikeQuestion(text: string) {
  return /\?|\b(what|how|where|when|which|who|why|can you|could you|is this|are you|do you|did you)\b/i.test(text);
}

function meaningfulText(text: string) {
  return text.trim().replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s!?.]+/gu, "").length >= 4;
}

function initialStatus(body: string) {
  return looksLikeQuestion(body) || meaningfulText(body) ? "needs_reply" as const : "new" as const;
}

function initialSentiment(body: string): AudienceInteraction["sentiment"] {
  if (looksLikeQuestion(body)) return "question";
  if (/\b(love|amazing|great|beautiful|fire|favorite|favourite|obsessed|incredible|wow)\b|❤️|🔥|😍|🙌/i.test(body)) return "positive";
  if (/\b(hate|bad|awful|terrible|boring|fake|spam)\b/i.test(body)) return "negative";
  return "neutral";
}

type InteractionUpsert = Partial<AudienceInteraction> &
  Pick<AudienceInteraction, "owner_id" | "platform" | "interaction_type" | "external_interaction_id" | "body"> & {
    artist_id: string;
  };

async function upsertInteraction(row: InteractionUpsert) {
  const db = createAutonomyServiceClient();
  const { error } = await db.from("audience_interactions").upsert({
    ...row,
    status: row.status ?? initialStatus(row.body),
    sentiment: row.sentiment ?? initialSentiment(row.body),
  }, { onConflict: "artist_id,platform,external_interaction_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function syncInstagramComments(ownerId: string, artistId: string, postIds: string[]) {
  if (!postIds.length) return 0;
  const access = await requireSocialAccess(ownerId, artistId, "instagram");
  let imported = 0;
  for (const postId of postIds.slice(0, MAX_POSTS_PER_PLATFORM)) {
    const url = new URL(instagramUrl(`/${postId}/comments`));
    url.searchParams.set("fields", "id,text,timestamp,from,username,parent_id");
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", access.accessToken);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) continue;
    const payload = await response.json() as {
      data?: Array<{
        id?: string;
        text?: string;
        timestamp?: string;
        username?: string;
        parent_id?: string;
        from?: { id?: string; username?: string };
      }>;
    };
    for (const comment of payload.data ?? []) {
      if (!comment.id || !comment.text) continue;
      await upsertInteraction({
        owner_id: ownerId,
        artist_id: artistId,
        platform: "instagram",
        interaction_type: comment.parent_id ? "reply" : "comment",
        external_interaction_id: comment.id,
        external_parent_id: comment.parent_id ?? null,
        external_post_id: postId,
        author_name: comment.username ?? comment.from?.username ?? null,
        author_handle: comment.username ?? comment.from?.username ?? null,
        body: comment.text,
        occurred_at: comment.timestamp ?? new Date().toISOString(),
        raw: asJson(comment),
      });
      imported += 1;
    }
  }
  return imported;
}

async function syncYouTubeComments(ownerId: string, artistId: string, videoIds: string[]) {
  if (!videoIds.length) return 0;
  const access = await requireSocialAccess(ownerId, artistId, "youtube", ["https://www.googleapis.com/auth/youtube.readonly"]);
  let imported = 0;
  for (const videoId of videoIds.slice(0, MAX_POSTS_PER_PLATFORM)) {
    const url = new URL(`${YOUTUBE_API_URL}/commentThreads`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("order", "time");
    url.searchParams.set("textFormat", "plainText");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) continue;
    const payload = await response.json() as {
      items?: Array<{
        id?: string;
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              authorDisplayName?: string;
              authorChannelUrl?: string;
              textOriginal?: string;
              publishedAt?: string;
            };
          };
        };
      }>;
    };
    for (const thread of payload.items ?? []) {
      const comment = thread.snippet?.topLevelComment;
      const snippet = comment?.snippet;
      if (!comment?.id || !snippet?.textOriginal) continue;
      await upsertInteraction({
        owner_id: ownerId,
        artist_id: artistId,
        platform: "youtube",
        interaction_type: "comment",
        external_interaction_id: comment.id,
        external_parent_id: null,
        external_post_id: videoId,
        author_name: snippet.authorDisplayName ?? null,
        author_handle: snippet.authorChannelUrl ?? null,
        body: snippet.textOriginal,
        occurred_at: snippet.publishedAt ?? new Date().toISOString(),
        raw: asJson(thread),
      });
      imported += 1;
    }
  }
  return imported;
}

async function artistScopesWithRecentPublications(): Promise<AudienceArtistScope[]> {
  const client = createMarketingServiceClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from("publication_jobs")
    .select("owner_id,artist_id")
    .eq("status", "published")
    .gte("published_at", since);
  if (error) throw new Error(error.message);
  const unique = new Map<string, AudienceArtistScope>();
  for (const row of data ?? []) {
    unique.set(`${row.owner_id}:${row.artist_id}`, { ownerId: row.owner_id, artistId: row.artist_id });
  }
  return [...unique.values()];
}

async function recentPublishedIds(ownerId: string, artistId: string, platform: "Instagram" | "YouTube Shorts") {
  const client = createMarketingServiceClient();
  const { data, error } = await client.from("publication_jobs")
    .select("external_post_id")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("platform", platform)
    .eq("status", "published")
    .not("external_post_id", "is", null)
    .order("published_at", { ascending: false })
    .limit(MAX_POSTS_PER_PLATFORM);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.external_post_id).filter((id): id is string => Boolean(id));
}

async function syncDue(ownerId: string, artistId: string) {
  const client = createMarketingServiceClient();
  const threshold = new Date(Date.now() - AUDIENCE_SYNC_INTERVAL_MS).toISOString();
  const { data, error } = await client.from("marketing_events")
    .select("occurred_at")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("event_type", "audience.sync.completed")
    .gte("occurred_at", threshold)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !data;
}

async function draftReply(ownerId: string, artistId: string, interaction: AudienceInteraction) {
  const result = await runAtlasAiTask<{
    reply: string;
    shouldReply: boolean;
    confidence: number;
    sentiment: "positive" | "neutral" | "negative" | "question";
  }>({
    ownerId,
    task: "community.reply",
    purpose: "community.reply",
    promptVersion: "community-reply-v2-artist-scoped",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["reply", "shouldReply", "confidence", "sentiment"],
      properties: {
        reply: { type: "string", minLength: 1, maxLength: 320 },
        shouldReply: { type: "boolean" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative", "question"] },
      },
    },
    instructions: [
      "You draft replies on behalf of the current music artist.",
      "Sound like a real artist replying personally, not a brand, marketer, assistant or AI.",
      "Be warm, short and specific to the person's message. Never add a sales pitch, streaming CTA, hashtags or generic engagement bait.",
      "Do not invent production facts, collaborators, release dates, identity details or personal details.",
      "For criticism, conflict, collaboration, booking, money, rights, legal or sensitive messages, set shouldReply=false and provide a neutral draft for human review.",
      "Simple emoji-only praise normally does not need a drafted reply.",
    ].join("\n"),
    input: JSON.stringify({
      artistId,
      platform: interaction.platform,
      author: interaction.author_name || interaction.author_handle,
      message: interaction.body,
    }),
    inputContext: { artistId, interactionId: interaction.id, platform: interaction.platform },
    cacheMode: "use",
  });
  return result.value;
}

async function draftPendingReplies(ownerId: string, artistId: string) {
  const db = createAutonomyServiceClient();
  const { data, error } = await db.from("audience_interactions")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("status", "needs_reply")
    .is("suggested_reply", null)
    .order("occurred_at", { ascending: false })
    .limit(MAX_REPLY_DRAFTS_PER_CYCLE);
  if (error) throw new Error(error.message);
  let drafted = 0;
  for (const interaction of data ?? []) {
    try {
      const suggestion = await draftReply(ownerId, artistId, interaction);
      const { error: updateError } = await db.from("audience_interactions").update({
        suggested_reply: suggestion.reply,
        reply_confidence: Math.max(0, Math.min(1, Number(suggestion.confidence) || 0)),
        sentiment: suggestion.sentiment,
        status: suggestion.shouldReply ? "drafted" : "needs_reply",
        auto_reply_eligible: false,
      }).eq("id", interaction.id).eq("owner_id", ownerId).eq("artist_id", artistId);
      if (updateError) throw new Error(updateError.message);
      drafted += 1;
    } catch {
      // Audience sync must remain useful even if text AI is out of budget or temporarily unavailable.
    }
  }
  return drafted;
}

export async function syncAudienceInteractions(scope?: AudienceArtistScope) {
  const scopes = scope ? [scope] : await artistScopesWithRecentPublications();
  const client = createMarketingServiceClient();
  let imported = 0;
  let drafted = 0;
  let artistsSynced = 0;
  for (const { ownerId, artistId } of scopes) {
    if (!await syncDue(ownerId, artistId)) continue;
    const [instagramIds, youtubeIds] = await Promise.all([
      recentPublishedIds(ownerId, artistId, "Instagram"),
      recentPublishedIds(ownerId, artistId, "YouTube Shorts"),
    ]);
    const results = await Promise.allSettled([
      syncInstagramComments(ownerId, artistId, instagramIds),
      syncYouTubeComments(ownerId, artistId, youtubeIds),
    ]);
    let artistImported = 0;
    for (const result of results) if (result.status === "fulfilled") artistImported += result.value;
    const artistDrafted = await draftPendingReplies(ownerId, artistId);
    imported += artistImported;
    drafted += artistDrafted;
    await client.from("marketing_events").insert({
      owner_id: ownerId,
      artist_id: artistId,
      campaign_id: null,
      event_type: "audience.sync.completed",
      entity_type: "audience",
      entity_id: null,
      payload: { imported: artistImported, drafted: artistDrafted },
    });
    artistsSynced += 1;
  }
  return { artistsSynced, ownersSynced: artistsSynced, imported, drafted };
}

export async function sendAudienceReply(ownerId: string, artistId: string, interactionId: string, reply: string) {
  const db = createAutonomyServiceClient();
  const { data: interaction, error } = await db.from("audience_interactions")
    .select("*")
    .eq("id", interactionId)
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .single();
  if (error || !interaction) throw new Error(error?.message || "Audience interaction was not found for this artist.");
  const message = reply.trim();
  if (!message || message.length > 1000) throw new Error("Reply must be between 1 and 1000 characters.");

  if (interaction.platform === "instagram") {
    const access = await requireSocialAccess(ownerId, artistId, "instagram");
    const response = await fetch(instagramUrl(`/${interaction.external_interaction_id}/replies`), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message, access_token: access.accessToken }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Instagram reply failed (${response.status}): ${detail.slice(0, 400)}`);
    }
  } else if (interaction.platform === "youtube") {
    const access = await requireSocialAccess(ownerId, artistId, "youtube", ["https://www.googleapis.com/auth/youtube.force-ssl"]);
    const url = new URL(`${YOUTUBE_API_URL}/comments`);
    url.searchParams.set("part", "snippet");
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${access.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: interaction.external_interaction_id, textOriginal: message } }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`YouTube reply failed (${response.status}): ${detail.slice(0, 400)}`);
    }
  } else {
    throw new Error("TikTok comment replies are not enabled because the current TikTok API connection does not expose a supported first-party reply endpoint for this workflow.");
  }

  const { error: updateError } = await db.from("audience_interactions").update({
    suggested_reply: message,
    status: "replied",
    auto_reply_eligible: false,
  }).eq("id", interaction.id).eq("owner_id", ownerId).eq("artist_id", artistId);
  if (updateError) throw new Error(updateError.message);
  return { replied: true };
}
