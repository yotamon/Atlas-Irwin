import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/types/database";
import type { GrowthDatabase } from "@/types/growth-database";
import type { SocialDatabase } from "@/types/social-database";
import { createMarketingServiceClient } from "./db";
import {
  plannerPlatformsFromConnections,
  socialPlatformForPlannerPlatform,
  type CampaignSocialPlatform,
} from "./social-platforms";
import { releaseRelativeTimestamp } from "./schedule";
import {
  daysSinceRelease,
  lifecyclePlanningPrinciple,
  relativeDayForFutureOffset,
  releaseLifecycle,
  type ReleaseLifecycle,
} from "./release-lifecycle";

const EXECUTION_PLAN_VERSION = "lifecycle-execution-v1";
const DEFAULT_LOCAL_TIME = "18:00";
const DEFAULT_TIMEZONE = "Europe/Berlin";

type JsonObject = Record<string, Json | undefined>;

type ReleaseContext = {
  id: string;
  owner_id: string;
  title: string;
  status: string;
  release_date: string | null;
  core_emotion: string | null;
  audience: string | null;
  primary_hook: string | null;
  visual_direction: string | null;
  artwork_url: string | null;
  smart_link_url: string | null;
  spotify_url: string | null;
  soundcloud_url: string | null;
};

type Blueprint = {
  title: string;
  relativeDay: number;
  goal: string;
  contentAngle: string;
  hookText: string;
  caption: string;
  cta: string;
  productionNotes: string;
};

function asJson(value: unknown) {
  return value as Json;
}

function objectValue(value: Json): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function nativeFormat(platform: CampaignSocialPlatform) {
  if (platform === "Instagram") return "Reel";
  if (platform === "TikTok") return "TikTok video";
  return "Short";
}

function fallbackAudience(release: ReleaseContext) {
  return release.audience?.trim() || "listeners who connect with warm, design-aware electronic music";
}

function fallbackHook(release: ReleaseContext) {
  return release.primary_hook?.trim() || "the strongest musical payoff in the track";
}

function fallbackEmotion(release: ReleaseContext) {
  return release.core_emotion?.trim() || "late-night connection and movement";
}

function releaseDestination(release: ReleaseContext) {
  return release.smart_link_url || release.spotify_url || release.soundcloud_url || null;
}

function upcomingBlueprints(release: ReleaseContext): Blueprint[] {
  const title = release.title;
  const hook = fallbackHook(release);
  const emotion = fallbackEmotion(release);
  return [
    {
      title: `${title}: world signal`, relativeDay: -14, goal: "Reach", contentAngle: "world and mood",
      hookText: `A first glimpse into ${title}.`,
      caption: `${title} lives somewhere between ${emotion} and the moment the night gets its second wind.`,
      cta: "Stay close for the full track.",
      productionNotes: "Introduce one recognizable visual/musical motif. Keep the piece authored and restrained; do not explain the whole release.",
    },
    {
      title: `${title}: strongest hook`, relativeDay: -7, goal: "Saves", contentAngle: "musical payoff",
      hookText: `The moment ${title} opens up.`,
      caption: `${title}. Built around ${hook}.`,
      cta: "Save this if this is your kind of second wind.",
      productionNotes: "Use Track Intelligence and the best matching Audio Scene. Put the musical payoff in the first second instead of building a generic teaser.",
    },
    {
      title: `${title}: human detail`, relativeDay: -2, goal: "Profile Visits", contentAngle: "human process",
      hookText: "One detail inside the track that changed the whole feeling.",
      caption: `A small piece of the process behind ${title}.`,
      cta: "The full track lands soon.",
      productionNotes: "Use lyrics/stems/process context if available. Prefer a specific detail over generic behind-the-scenes language.",
    },
    {
      title: `${title}: release-day conversion`, relativeDay: 0, goal: "Streams", contentAngle: "full-track promise",
      hookText: `${title} is out now.`,
      caption: `${title} is live. Start with the moment that made the release worth finishing.`,
      cta: "Hear the full track.",
      productionNotes: "Reuse the strongest proven visual and musical framing. Release day is not permission to invent a new creative world.",
    },
    {
      title: `${title}: first-week continuation`, relativeDay: 7, goal: "Follows", contentAngle: "second angle",
      hookText: `Another way into ${title}.`,
      caption: `The release is still moving. This time, listen for ${hook}.`,
      cta: "Follow Atlas Irwin for the next chapter.",
      productionNotes: "Use a different musical detail, lyric moment or stem treatment while preserving the same release identity.",
    },
  ];
}

function liveBlueprints(release: ReleaseContext, lifecycle: ReleaseLifecycle, now = new Date()): Blueprint[] {
  if (!release.release_date) return [];
  const title = release.title;
  const hook = fallbackHook(release);
  const emotion = fallbackEmotion(release);
  const relative = (offset: number) => relativeDayForFutureOffset(release.release_date!, offset, now);
  const catalog = lifecycle === "catalog";
  return [
    {
      title: `${title}: ${catalog ? "catalog re-entry" : "continue from today"}`,
      relativeDay: relative(1), goal: "Reach", contentAngle: "rediscovery",
      hookText: catalog ? `If you missed ${title}, start here.` : `The release is live. Start with the strongest moment.`,
      caption: catalog
        ? `${title} has been out for a while. This is the part I would use to introduce it today.`
        : `${title} is already live, so Atlas is continuing from today instead of recreating missed launch posts.`,
      cta: "Hear the full track.",
      productionNotes: `Use ${hook}. This is a fresh current-day entry point, never a fake pre-release teaser.`,
    },
    {
      title: `${title}: musical detail`, relativeDay: relative(4), goal: "Saves", contentAngle: "inside the track",
      hookText: "The layer that changes the whole groove.",
      caption: `${title}, from the inside out.`,
      cta: "Save it if this detail gets you.",
      productionNotes: "Prefer Stem Intelligence or a pinned Audio Scene. A progressive reveal or instrument spotlight should show why the track is interesting, not just decorate it.",
    },
    {
      title: `${title}: emotional / lyric angle`, relativeDay: relative(8), goal: "Follows", contentAngle: "song meaning",
      hookText: `The feeling underneath ${title}.`,
      caption: `${emotion}. That is the thread running through ${title}.`,
      cta: "Follow if you want the next chapter.",
      productionNotes: "Use Lyrics Intelligence when available. Exact lyric text may appear only when the stored lyric permissions allow quoting.",
    },
    {
      title: `${title}: selector angle`, relativeDay: relative(14), goal: "DJ Discovery", contentAngle: "selector utility",
      hookText: "For selectors who need movement without turning the room into noise.",
      caption: `${title} was built to keep the room moving without flattening the details.`,
      cta: "DJ or selector? Keep it for a set.",
      productionNotes: "Use a groove-led Audio Scene or the strongest mix-friendly window. No fake crowd footage or festival clichés.",
    },
  ];
}

function actionableBlueprints(release: ReleaseContext, lifecycle: ReleaseLifecycle, now = new Date()) {
  if (!release.release_date || lifecycle === "development" || lifecycle === "archived") return [];
  const source = lifecycle === "upcoming" ? upcomingBlueprints(release) : liveBlueprints(release, lifecycle, now);
  const cutoff = now.getTime() + 60 * 60 * 1000;
  return source.filter((item) => {
    const scheduledAt = releaseRelativeTimestamp(release.release_date, item.relativeDay, DEFAULT_LOCAL_TIME, DEFAULT_TIMEZONE);
    return Boolean(scheduledAt && new Date(scheduledAt).getTime() > cutoff);
  });
}

async function connectedPlatforms(ownerId: string) {
  const service = createServiceClient() as unknown as SupabaseClient<SocialDatabase>;
  const { data, error } = await service.from("social_channel_accounts")
    .select("platform,status")
    .eq("owner_id", ownerId)
    .eq("status", "connected");
  if (error) throw new Error(error.message);
  return plannerPlatformsFromConnections(data ?? []);
}

async function hookWindow(ownerId: string, releaseId: string) {
  const service = createServiceClient() as unknown as SupabaseClient<GrowthDatabase>;
  const { data, error } = await service.from("track_vault")
    .select("hook_start_seconds,hook_end_seconds,analysis_confidence")
    .eq("owner_id", ownerId)
    .eq("linked_release_id", releaseId)
    .order("analysis_confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function ensureLifecycleCampaignExecution(campaignId: string, now = new Date()) {
  const marketing = createMarketingServiceClient();
  const catalog = createServiceClient();
  const { data: campaign, error: campaignError } = await marketing.from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) throw new Error(campaignError.message);
  if (!campaign?.release_id || campaign.status === "archived" || campaign.status === "completed") {
    return { outcome: "not_actionable" as const, campaignId };
  }

  const [{ data: release, error: releaseError }, { count: contentCount, error: contentCountError }] = await Promise.all([
    catalog.from("releases")
      .select("id,owner_id,title,status,release_date,core_emotion,audience,primary_hook,visual_direction,artwork_url,smart_link_url,spotify_url,soundcloud_url")
      .eq("id", campaign.release_id)
      .eq("owner_id", campaign.owner_id)
      .maybeSingle(),
    marketing.from("content_items")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", campaign.owner_id)
      .eq("campaign_id", campaign.id)
      .not("status", "eq", "Archived"),
  ]);
  if (releaseError || !release) throw new Error(releaseError?.message || "Campaign release not found.");
  if (contentCountError) throw new Error(contentCountError.message);
  if ((contentCount ?? 0) > 0) return { outcome: "queue_exists" as const, campaignId, contentCount: contentCount ?? 0 };

  const lifecycle = releaseLifecycle({ releaseDate: release.release_date, status: release.status }, now);
  const platforms = await connectedPlatforms(campaign.owner_id);
  const currentStrategy = objectValue(campaign.strategy);
  const blockedReason = lifecycle === "development"
    ? "release_date_needed"
    : lifecycle === "archived"
      ? "release_archived"
      : !platforms.length
        ? "no_connected_social_channels"
        : null;

  if (blockedReason) {
    const { error: blockedError } = await marketing.from("campaigns").update({
      strategy: asJson({
        ...currentStrategy,
        executionPlanVersion: EXECUTION_PLAN_VERSION,
        lifecycle,
        lifecyclePrinciple: lifecyclePlanningPrinciple(lifecycle),
        executionBlocked: blockedReason,
        executionCheckedAt: now.toISOString(),
      }),
    }).eq("id", campaign.id);
    if (blockedError) throw new Error(blockedError.message);
    return { outcome: "blocked" as const, campaignId, lifecycle, reason: blockedReason };
  }

  const blueprints = actionableBlueprints(release as ReleaseContext, lifecycle, now);
  if (!blueprints.length) {
    return { outcome: "nothing_to_schedule" as const, campaignId, lifecycle };
  }
  const primaryPlatform = platforms[0];
  const hook = await hookWindow(campaign.owner_id, release.id);
  const destination = releaseDestination(release as ReleaseContext);

  const { data: run, error: runError } = await marketing.from("generation_runs").insert({
    owner_id: campaign.owner_id,
    campaign_id: campaign.id,
    release_id: release.id,
    purpose: "campaign_execution_plan",
    task_type: null,
    provider: "atlas-deterministic",
    model: EXECUTION_PLAN_VERSION,
    requested_model: EXECUTION_PLAN_VERSION,
    prompt_version: EXECUTION_PLAN_VERSION,
    input_context: asJson({ releaseId: release.id, lifecycle, connectedPlatforms: platforms }),
    output: asJson({ blueprints, primaryPlatform, lifecycle }),
    status: "completed",
    attempt_index: 0,
    started_at: now.toISOString(),
    completed_at: now.toISOString(),
    actual_cost_usd: 0,
    estimated_cost_usd: 0,
    quality_gate_passed: true,
    quality_score: 1,
    metadata: asJson({ deterministic: true, lifecycleAware: true }),
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message || "Could not record deterministic execution plan.");

  const rows = blueprints.map((item) => ({
    owner_id: campaign.owner_id,
    release_id: release.id,
    campaign_id: campaign.id,
    phase_id: null,
    experiment_id: null,
    title: item.title,
    platform: primaryPlatform,
    format: nativeFormat(primaryPlatform),
    status: "Draft",
    goal: item.goal,
    scheduled_at: releaseRelativeTimestamp(release.release_date, item.relativeDay, DEFAULT_LOCAL_TIME, DEFAULT_TIMEZONE),
    published_at: null,
    approval_status: "not_required" as const,
    source: "automation" as const,
    generated_from_run_id: run.id,
    content_angle: item.contentAngle,
    audience_segment: fallbackAudience(release as ReleaseContext),
    relative_day: item.relativeDay,
    schedule_locked: false,
    schedule_local_time: "18:00:00",
    schedule_timezone: DEFAULT_TIMEZONE,
    audio_timestamp_start: hook?.hook_start_seconds ?? null,
    audio_timestamp_end: hook?.hook_end_seconds ?? null,
    hook_text: item.hookText,
    caption: item.caption,
    cta: item.cta,
    visual_prompt: release.visual_direction,
    production_notes: `${item.productionNotes}${destination ? `\nCampaign destination: ${destination}` : ""}`,
    asset_url: null,
  }));
  const { data: created, error: contentError } = await marketing.from("content_items").insert(rows).select("id");
  if (contentError) throw new Error(contentError.message);

  const { error: strategyError } = await marketing.from("campaigns").update({
    status: campaign.status === "active" ? "active" : "planned",
    strategy: asJson({
      ...currentStrategy,
      executionPlanVersion: EXECUTION_PLAN_VERSION,
      executionSource: "atlas-deterministic",
      lifecycle,
      lifecyclePrinciple: lifecyclePlanningPrinciple(lifecycle),
      executionBlocked: null,
      executionPlannedAt: now.toISOString(),
      strategySummary: typeof currentStrategy.strategySummary === "string"
        ? currentStrategy.strategySummary
        : lifecycle === "upcoming"
          ? `Move ${release.title} toward release day without creating filler. Atlas will prepare only future, connected-channel moments.`
          : `Treat ${release.title} as live music. Continue from today with rediscovery angles instead of recreating missed launch activity.`,
    }),
  }).eq("id", campaign.id);
  if (strategyError) throw new Error(strategyError.message);

  await marketing.from("marketing_events").insert({
    owner_id: campaign.owner_id,
    campaign_id: campaign.id,
    event_type: "campaign.execution_queue_created",
    entity_type: "campaign",
    entity_id: campaign.id,
    payload: asJson({ lifecycle, contentItemIds: (created ?? []).map((item) => item.id), costUsd: 0 }),
  });

  return {
    outcome: "queue_created" as const,
    campaignId,
    lifecycle,
    contentItemIds: (created ?? []).map((item) => item.id),
    platform: primaryPlatform,
  };
}

export async function ensurePublicationApprovalForContent(contentItemId: string) {
  const marketing = createMarketingServiceClient();
  const service = createServiceClient() as unknown as SupabaseClient<SocialDatabase>;
  const { data: item, error: itemError } = await marketing.from("content_items")
    .select("*")
    .eq("id", contentItemId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (!item?.asset_url || !item.scheduled_at || item.status === "Published" || item.status === "Archived") {
    return { outcome: "not_ready" as const, contentItemId };
  }

  const key = socialPlatformForPlannerPlatform(item.platform);
  if (!key) return { outcome: "unsupported_platform" as const, contentItemId, platform: item.platform };
  const { data: connection, error: connectionError } = await service.from("social_channel_accounts")
    .select("status,can_publish")
    .eq("owner_id", item.owner_id)
    .eq("platform", key)
    .maybeSingle();
  if (connectionError) throw new Error(connectionError.message);
  if (connection?.status !== "connected") return { outcome: "channel_disconnected" as const, contentItemId, platform: item.platform };

  const { data: existing, error: existingError } = await marketing.from("publication_jobs")
    .select("id,status")
    .eq("owner_id", item.owner_id)
    .eq("content_item_id", item.id)
    .not("status", "eq", "cancelled")
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return { outcome: "publication_exists" as const, contentItemId, publicationJobId: existing.id };

  const { data: publication, error: publicationError } = await marketing.from("publication_jobs").insert({
    owner_id: item.owner_id,
    campaign_id: item.campaign_id,
    content_item_id: item.id,
    content_variant_id: null,
    platform: item.platform,
    adapter: key,
    status: "awaiting_approval",
    requires_approval: true,
    approval_status: "pending",
    scheduled_at: item.scheduled_at,
    request_payload: asJson({
      caption: item.caption,
      hookText: item.hook_text,
      cta: item.cta,
      assetUrl: item.asset_url,
      format: item.format,
      source: item.source,
      aiGenerated: item.source === "ai",
    }),
    result: asJson({}),
    idempotency_key: `content:${item.id}:publication:v1`,
  }).select("id").single();
  if (publicationError || !publication) throw new Error(publicationError?.message || "Could not create publication approval.");

  await marketing.from("content_items").update({ status: "Ready" }).eq("id", item.id).neq("status", "Scheduled");
  return { outcome: "approval_created" as const, contentItemId, publicationJobId: publication.id };
}

export async function ensureReadyContentPublicationApprovals(limit = 25) {
  const marketing = createMarketingServiceClient();
  const { data, error } = await marketing.from("content_items")
    .select("id")
    .not("asset_url", "is", null)
    .not("scheduled_at", "is", null)
    .not("status", "in", '("Published","Archived")')
    .order("scheduled_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(error.message);
  let created = 0;
  for (const item of data ?? []) {
    const result = await ensurePublicationApprovalForContent(item.id);
    if (result.outcome === "approval_created") created += 1;
  }
  return { considered: data?.length ?? 0, created };
}
