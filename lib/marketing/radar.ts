import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/config";
import { createAutonomyServiceClient } from "./autonomy-db";
import { createMarketingServiceClient } from "./db";
import { requireSocialAccess } from "./social-auth";
import type { ArtistScopedSocialDatabase } from "@/types/artist-scoped-operational-database";
import type { Json } from "@/types/database";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const RADAR_INTERVAL_MS = 20 * 60 * 60 * 1000;
const DEFAULT_QUERIES = ["nu disco", "disco house", "electronic music visualizer"];

type RadarArtist = { ownerId: string; artistId: string };

function serviceSocial() {
  const { url } = getSupabaseEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the marketing radar.");
  return createClient<ArtistScopedSocialDatabase>(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function asJson(value: unknown) {
  return value as Json;
}

function queries() {
  const configured = (process.env.ATLAS_RADAR_YOUTUBE_QUERIES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return (configured.length ? configured : DEFAULT_QUERIES).slice(0, 3);
}

function ageDays(publishedAt: string | undefined) {
  if (!publishedAt) return 30;
  return Math.max(0, (Date.now() - new Date(publishedAt).getTime()) / 86_400_000);
}

function opportunityScore(views: number, days: number) {
  const velocity = views / Math.max(0.5, days);
  const velocityScore = Math.min(65, Math.log10(Math.max(1, velocity)) * 15);
  const freshness = Math.max(0, 25 - days * 3);
  return Math.max(0, Math.min(100, Math.round((velocityScore + freshness + 10) * 10) / 10));
}

async function radarDue(ownerId: string, artistId: string) {
  const client = createMarketingServiceClient();
  const threshold = new Date(Date.now() - RADAR_INTERVAL_MS).toISOString();
  const { data, error } = await client.from("marketing_events")
    .select("occurred_at")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .eq("event_type", "radar.scan.completed")
    .gte("occurred_at", threshold)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !data;
}

async function youtubeArtists(): Promise<RadarArtist[]> {
  const { data, error } = await serviceSocial().from("social_channel_accounts")
    .select("owner_id,artist_id")
    .eq("platform", "youtube")
    .eq("status", "connected");
  if (error) throw new Error(error.message);
  const unique = new Map<string, RadarArtist>();
  for (const row of data ?? []) {
    unique.set(`${row.owner_id}:${row.artist_id}`, { ownerId: row.owner_id, artistId: row.artist_id });
  }
  return [...unique.values()];
}

async function scanYouTube(ownerId: string, artistId: string) {
  const access = await requireSocialAccess(ownerId, artistId, "youtube", ["https://www.googleapis.com/auth/youtube.readonly"]);
  const found = new Map<string, { id: string; title: string; channelTitle: string; publishedAt: string; query: string }>();
  const publishedAfter = new Date(Date.now() - 10 * 86_400_000).toISOString();

  for (const query of queries()) {
    const url = new URL(`${YOUTUBE_API_URL}/search`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "viewCount");
    url.searchParams.set("publishedAfter", publishedAfter);
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${access.accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) continue;
    const payload = await response.json() as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string } }>;
    };
    for (const item of payload.items ?? []) {
      const id = item.id?.videoId;
      if (!id || !item.snippet?.title) continue;
      found.set(id, {
        id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle || "Unknown channel",
        publishedAt: item.snippet.publishedAt || new Date().toISOString(),
        query,
      });
    }
  }

  if (!found.size) return 0;
  const ids = [...found.keys()];
  const statsUrl = new URL(`${YOUTUBE_API_URL}/videos`);
  statsUrl.searchParams.set("part", "statistics,snippet");
  statsUrl.searchParams.set("id", ids.join(","));
  const response = await fetch(statsUrl, {
    headers: { Authorization: `Bearer ${access.accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return 0;
  const payload = await response.json() as {
    items?: Array<{
      id?: string;
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
    }>;
  };

  const db = createAutonomyServiceClient();
  let saved = 0;
  for (const item of payload.items ?? []) {
    if (!item.id) continue;
    const seed = found.get(item.id);
    if (!seed) continue;
    const views = Number(item.statistics?.viewCount) || 0;
    const likes = Number(item.statistics?.likeCount) || 0;
    const comments = Number(item.statistics?.commentCount) || 0;
    const days = ageDays(item.snippet?.publishedAt || seed.publishedAt);
    const score = opportunityScore(views, days);
    if (score < 45) continue;
    const urgency = Math.max(0, Math.min(100, Math.round((100 - days * 12) * 10) / 10));
    const { error } = await db.from("marketing_opportunities").upsert({
      owner_id: ownerId,
      artist_id: artistId,
      kind: "trend",
      source: "youtube-radar",
      external_key: item.id,
      title: item.snippet?.title || seed.title,
      summary: `${(views || 0).toLocaleString()} views in about ${Math.max(1, Math.round(days))} day${Math.round(days) === 1 ? "" : "s"}. Found through “${seed.query}”.`,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      score,
      urgency,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      evidence: asJson({ videoId: item.id, views, likes, comments, ageDays: days, query: seed.query, channel: item.snippet?.channelTitle || seed.channelTitle }),
      recommended_action: "Inspect the format, hook and visual grammar. Adapt the underlying idea only if it fits this artist; never copy the creative literally.",
      status: "new",
    }, { onConflict: "artist_id,source,external_key" });
    if (!error) saved += 1;
  }
  return saved;
}

async function scanArtistBreakouts(ownerId: string, artistId: string) {
  const client = createMarketingServiceClient();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data, error } = await client.from("metric_snapshots")
    .select("content_item_id,content_variant_id,platform,views,reach,saves,shares,comments,captured_at")
    .eq("owner_id", ownerId)
    .eq("artist_id", artistId)
    .gte("captured_at", since)
    .not("content_item_id", "is", null)
    .order("captured_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < 3) return 0;
  const signals = rows.map((row) => (row.views || row.reach || 0) + (row.saves || 0) * 8 + (row.shares || 0) * 10 + (row.comments || 0) * 4);
  const sorted = [...signals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const db = createAutonomyServiceClient();
  let saved = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const signal = signals[index];
    if (!row.content_item_id || signal < Math.max(25, median * 1.8)) continue;
    const lift = signal / Math.max(1, median);
    const { error: saveError } = await db.from("marketing_opportunities").upsert({
      owner_id: ownerId,
      artist_id: artistId,
      kind: "breakout",
      source: "artist-performance",
      external_key: `${row.content_item_id}:${row.platform}`,
      title: `${row.platform} content is outperforming the recent baseline`,
      summary: `Current weighted fan signal is ${lift.toFixed(1)}× the 14-day median.`,
      score: Math.min(100, 65 + (lift - 1.8) * 12),
      urgency: 90,
      expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      evidence: asJson({ contentItemId: row.content_item_id, contentVariantId: row.content_variant_id, platform: row.platform, signal, median, lift, capturedAt: row.captured_at }),
      recommended_action: "Create one or two derivatives while the framing is still working, using existing approved media before spending on new generation.",
      status: "new",
    }, { onConflict: "artist_id,source,external_key" });
    if (!saveError) saved += 1;
  }
  return saved;
}

export async function refreshMarketingRadarIfDue(scope?: RadarArtist) {
  const artists = scope ? [scope] : await youtubeArtists();
  const client = createMarketingServiceClient();
  let scanned = 0;
  let opportunities = 0;
  for (const { ownerId, artistId } of artists) {
    if (!await radarDue(ownerId, artistId)) continue;
    const [external, internal] = await Promise.allSettled([
      scanYouTube(ownerId, artistId),
      scanArtistBreakouts(ownerId, artistId),
    ]);
    let artistOpportunities = 0;
    if (external.status === "fulfilled") artistOpportunities += external.value;
    if (internal.status === "fulfilled") artistOpportunities += internal.value;
    opportunities += artistOpportunities;
    await client.from("marketing_events").insert({
      owner_id: ownerId,
      artist_id: artistId,
      campaign_id: null,
      event_type: "radar.scan.completed",
      entity_type: "radar",
      entity_id: null,
      payload: { opportunities: artistOpportunities },
    });
    scanned += 1;
  }
  return { scanned, opportunities };
}
