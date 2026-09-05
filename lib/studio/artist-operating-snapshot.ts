import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDistributionArtistState } from "@/lib/distribution/server";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { asMarketingClient } from "@/lib/marketing/db";
import { releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { loadPaidGrowthWorkspace, paidGrowthNeedsYou } from "@/lib/paid-growth/server";
import type { Database } from "@/types/database";
import type { ArtistContext } from "./artist-context";
import { asArtistScopedMusicClient } from "./music-db";
import { deriveNeedsYouQueue } from "./needs-you";
import {
  formatOperatingDate,
  formatOperatingDateTime,
  loadWorkspaceOperatingPreferences,
} from "./operating-preferences";
import { asArtistScopedOperationalClient } from "./operational-db";
import { deriveReleaseMission } from "./release-mission";

export type OperatingWorkingItem = {
  id: string;
  title: string;
  detail: string;
  status: "Queued" | "Working" | "Publishing";
  href: string;
};

export type OperatingComingUpItem = {
  id: string;
  title: string;
  detail: string;
  scheduledAt: string;
  href: string;
};

function dateDistance(value: string | null | undefined, now: Date) {
  if (!value) return "Date not set";
  const target = new Date(value.length === 10 ? `${value}T12:00:00Z` : value).getTime();
  const days = Math.ceil((target - now.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  const ago = Math.abs(days);
  return `${ago} day${ago === 1 ? "" : "s"} ago`;
}

function nextBestActionPath(action: { action_type: string }) {
  if (action.action_type === "reply_to_listener") return "/studio/audience";
  if (["approve_publication", "publish_overdue"].includes(action.action_type)) return "/studio/inbox";
  if (["repair_publication", "derive_winner_content"].includes(action.action_type)) return "/studio/production";
  return "/studio/growth";
}

function humanizeJobType(value: string | null | undefined) {
  if (!value) return "Background work";
  const known: Record<string, string> = {
    generate_campaign: "Building campaign",
    generate_content: "Creating content",
    create_content: "Creating content",
    analyze_track: "Analyzing track",
    analyze_audio: "Analyzing audio",
    analyze_stem: "Analyzing stem",
    render_master: "Rendering master",
    render_social: "Rendering social asset",
    publish_content: "Preparing publication",
    sync_metrics: "Refreshing performance data",
  };
  if (known[value]) return known[value];
  const sentence = value.replace(/[_-]+/g, " ").trim();
  return sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : "Background work";
}

export async function loadArtistOperatingSnapshot({
  db,
  userId,
  artist,
  now = new Date(),
}: {
  db: SupabaseClient<Database>;
  userId: string;
  artist: ArtistContext;
  now?: Date;
}) {
  const operational = asArtistScopedOperationalClient(db);
  const music = asArtistScopedMusicClient(db);
  const marketing = asMarketingClient(db);
  const autonomy = createAutonomyServiceClient();
  const preferencesPromise = loadWorkspaceOperatingPreferences(db, artist.workspaceId);
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [
    preferences,
    releasesResult,
    tracksResult,
    campaignsResult,
    tasksResult,
    automationResult,
    publicationResult,
    contentResult,
    learningsResult,
    nextActionsResult,
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
    paidWorkspace,
  ] = await Promise.all([
    preferencesPromise,
    music.from("releases").select("id,title,release_date,active_release,artwork_url,cover_asset,primary_hook,smart_link_url,spotify_url,soundcloud_url,youtube_url,status,is_archived").eq("owner_id", userId).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    music.from("tracks").select("id,release_id,audio_url,is_primary").eq("owner_id", userId).eq("artist_id", artist.artistId),
    marketing.from("campaigns").select("id,release_id,status").eq("owner_id", userId).eq("artist_id", artist.artistId).not("status", "eq", "archived"),
    operational.from("tasks").select("id,title,due_at,priority,status").eq("owner_id", userId).eq("artist_id", artist.artistId).not("status", "in", '("Done","Skipped")').order("due_at", { ascending: true }).limit(30),
    marketing.from("automation_jobs").select("id,campaign_id,job_type,status,approval_status,run_after").eq("owner_id", userId).eq("artist_id", artist.artistId).not("status", "in", '("completed","failed","cancelled")').order("run_after", { ascending: true }).limit(40),
    marketing.from("publication_jobs").select("id,campaign_id,content_item_id,platform,status,approval_status,scheduled_at").eq("owner_id", userId).eq("artist_id", artist.artistId).not("status", "in", '("published","failed","cancelled")').order("scheduled_at", { ascending: true }).limit(40),
    marketing.from("content_items").select("id,title,platform,status,asset_url,scheduled_at,release_id").eq("owner_id", userId).eq("artist_id", artist.artistId).not("status", "eq", "Archived").order("scheduled_at", { ascending: true }).limit(100),
    marketing.from("marketing_learnings").select("id,status").eq("owner_id", userId).eq("artist_id", artist.artistId).eq("status", "proposed").limit(20),
    autonomy.from("next_best_actions").select("id,title,rationale,action_type,score,status").eq("owner_id", userId).eq("artist_id", artist.artistId).eq("status", "proposed").order("score", { ascending: false }).limit(8),
    db.from("soundcloud_tracks").select("id,linked_track_id").eq("owner_id", userId).eq("reconcile_status", "pending"),
    db.from("spotify_tracks").select("id,linked_track_id").eq("owner_id", userId).eq("reconcile_status", "pending"),
    marketing.from("outreach_messages").select("id").eq("owner_id", userId).eq("artist_id", artist.artistId).is("sent_at", null).eq("response_status", "Draft"),
    loadPaidGrowthWorkspace({ db, ownerId: userId, artistId: artist.artistId }),
  ]);

  const firstError = [
    releasesResult,
    tracksResult,
    campaignsResult,
    tasksResult,
    automationResult,
    publicationResult,
    contentResult,
    learningsResult,
    nextActionsResult,
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
  ].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const campaigns = campaignsResult.data ?? [];
  const content = contentResult.data ?? [];
  const automation = automationResult.data ?? [];
  const publications = publicationResult.data ?? [];
  const nextAction = nextActionsResult.data?.[0] ?? null;
  const activeRelease = releases.find((release) => release.active_release)
    ?? releases.find((release) => release.release_date && release.release_date >= now.toISOString().slice(0, 10))
    ?? releases[0]
    ?? null;

  const workflowApprovalCount = automation.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length
    + publications.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length;
  const manualReady = publications.filter((job) => String(job.status) === "manual_ready");
  const unmatched = [...(soundCloudPendingResult.data ?? []), ...(spotifyPendingResult.data ?? [])].filter((item) => !item.linked_track_id).length;
  const missingAssets = content.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
  const proposedLearningCount = learningsResult.data?.length ?? 0;
  const dueTasks = (tasksResult.data ?? []).filter((task) => task.due_at && new Date(task.due_at) <= sevenDays);
  const outreachDraftCount = outreachDraftsResult.data?.length ?? 0;

  const activeReleaseContentIds = new Set(activeRelease ? content.filter((item) => item.release_id === activeRelease.id).map((item) => item.id) : []);
  const activeProviderScheduledCount = publications.filter((job) => job.content_item_id && activeReleaseContentIds.has(job.content_item_id) && String(job.status) === "provider_scheduled").length;
  const activeMission = activeRelease ? deriveReleaseMission({
    releaseId: activeRelease.id,
    lifecycle: releaseLifecycle({ releaseDate: activeRelease.release_date, status: activeRelease.status, isArchived: activeRelease.is_archived }, now),
    releaseDate: activeRelease.release_date,
    hasMasterAudio: tracks.some((track) => track.release_id === activeRelease.id && Boolean(track.audio_url)),
    hasArtwork: Boolean(activeRelease.artwork_url || activeRelease.cover_asset),
    hasCampaign: campaigns.some((campaign) => campaign.release_id === activeRelease.id),
    missingAssetTitles: missingAssets.filter((item) => item.release_id === activeRelease.id).map((item) => item.title),
    hasListeningDestination: Boolean(activeRelease.smart_link_url || activeRelease.spotify_url || activeRelease.soundcloud_url || activeRelease.youtube_url),
    hasPrimaryHook: Boolean(activeRelease.primary_hook),
    providerScheduledCount: activeProviderScheduledCount,
  }) : null;
  const activeDistribution = activeRelease ? await loadDistributionArtistState(db, userId, artist.artistId, activeRelease.id) : null;

  const needsYou = deriveNeedsYouQueue({
    activeReleaseId: activeRelease?.id ?? null,
    activeMission,
    distributionDecisions: activeRelease ? (activeDistribution?.decisions ?? []).map((decision) => ({ key: decision.key, title: decision.title, detail: decision.detail, severity: decision.severity, releaseId: activeRelease.id })) : [],
    paidGrowthDecisions: paidGrowthNeedsYou(paidWorkspace.cards),
    workflowApprovalCount,
    outreachDraftCount,
    manualReady: manualReady.map((job) => ({ id: job.id, platform: job.platform, contentItemId: job.content_item_id })),
    unmatchedCount: unmatched,
    missingAssets: missingAssets.map((item) => ({
      id: item.id,
      title: item.title,
      platform: item.platform,
      scheduledLabel: item.scheduled_at ? formatOperatingDate(item.scheduled_at, preferences) : null,
      releaseId: item.release_id,
    })),
    dueTasks: dueTasks.map((task) => ({ id: task.id, title: task.title, priority: task.priority, dueLabel: task.due_at ? dateDistance(task.due_at, now) : null })),
    proposedLearningCount,
  }).slice(0, 7);

  const working: OperatingWorkingItem[] = [
    ...automation.filter((job) => job.status === "queued" || job.status === "running").map((job) => ({
      id: `automation-${job.id}`,
      title: humanizeJobType(job.job_type),
      detail: job.run_after ? `Started from the automation plan · ${formatOperatingDateTime(job.run_after, preferences)}` : "Autonomous workflow",
      status: job.status === "running" ? "Working" as const : "Queued" as const,
      href: href("/studio/growth"),
    })),
    ...publications.filter((job) => String(job.status) === "publishing").map((job) => ({
      id: `publication-${job.id}`,
      title: `Publishing to ${job.platform}`,
      detail: job.scheduled_at ? formatOperatingDateTime(job.scheduled_at, preferences) : "Publication in progress",
      status: "Publishing" as const,
      href: href(job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/growth"),
    })),
  ].slice(0, 6);

  const scheduledPublications = publications.filter((job) => ["approved", "scheduled", "provider_scheduled"].includes(String(job.status)) && job.scheduled_at && new Date(job.scheduled_at) >= now && new Date(job.scheduled_at) <= sevenDays);
  const scheduledIds = new Set(scheduledPublications.map((job) => job.content_item_id).filter(Boolean));
  const upcomingContent = content.filter((item) => item.scheduled_at && new Date(item.scheduled_at) >= now && new Date(item.scheduled_at) <= sevenDays && !scheduledIds.has(item.id));
  const comingUp: OperatingComingUpItem[] = [
    ...scheduledPublications.map((job) => ({
      id: `publication-${job.id}`,
      title: `${job.platform} publication`,
      detail: "Scheduled and ready",
      scheduledAt: job.scheduled_at!,
      href: href(job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/growth"),
    })),
    ...upcomingContent.map((item) => ({
      id: `content-${item.id}`,
      title: item.title,
      detail: `${item.platform} content`,
      scheduledAt: item.scheduled_at!,
      href: href(`/studio/production?edit=${item.id}`),
    })),
  ].sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt)).slice(0, 7);

  return {
    generatedAt: now.toISOString(),
    preferences,
    activeRelease,
    activeMission,
    needsYou,
    topDecision: needsYou[0] ?? null,
    nextAction,
    nextActionHref: nextAction ? href(nextBestActionPath(nextAction)) : null,
    working,
    comingUp,
  };
}
