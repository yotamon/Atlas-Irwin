import Link from "next/link";
import { CalmState, DecisionQueue, DecisionRow, PriorityHero, type SemanticTone } from "@/components/studio/patterns";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadDistributionArtistState } from "@/lib/distribution/server";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { loadPaidGrowthWorkspace, paidGrowthNeedsYou } from "@/lib/paid-growth/server";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { deriveNeedsYouQueue, needsYouTone } from "@/lib/studio/needs-you";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { deriveReleaseMission } from "@/lib/studio/release-mission";

function shortDate(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Europe/Berlin" })
    .format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
}

function dateDistance(value: string | null | undefined) {
  if (!value) return null;
  const target = new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime();
  const days = Math.ceil((target - Date.now()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  const ago = Math.abs(days);
  return `${ago} day${ago === 1 ? "" : "s"} ago`;
}

function decisionTone(value: string): SemanticTone {
  if (value === "important") return "danger";
  if (value === "warning") return "attention";
  return "neutral";
}

export default async function NeedsYouPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const music = supabase;
  const marketing = asMarketingClient(supabase);
  const now = new Date();
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [releasesResult, tracksResult, campaignsResult, tasksResult, automationResult, publicationResult, contentResult, learningsResult, soundCloudPendingResult, spotifyPendingResult, outreachDraftsResult, paidWorkspace] = await Promise.all([
    music.from("releases").select("id,title,release_date,active_release,artwork_url,cover_asset,primary_hook,smart_link_url,spotify_url,soundcloud_url,youtube_url,status,is_archived").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    music.from("tracks").select("id,release_id,audio_url,is_primary").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    marketing.from("campaigns").select("id,release_id,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "eq", "archived"),
    operational.from("tasks").select("id,title,due_at,priority,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("Done","Skipped")').order("due_at", { ascending: true }).limit(30),
    marketing.from("automation_jobs").select("id,status,approval_status").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("completed","failed","cancelled")').limit(60),
    marketing.from("publication_jobs").select("id,content_item_id,platform,status,approval_status,scheduled_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("published","failed","cancelled")').order("scheduled_at", { ascending: true }).limit(60),
    marketing.from("content_items").select("id,title,platform,status,asset_url,scheduled_at,release_id").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "eq", "Archived").order("scheduled_at", { ascending: true }).limit(120),
    marketing.from("marketing_learnings").select("id,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "proposed").limit(40),
    supabase.from("soundcloud_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    marketing.from("outreach_messages").select("id").eq("owner_id", user.id).eq("artist_id", artist.artistId).is("sent_at", null).eq("response_status", "Draft"),
    loadPaidGrowthWorkspace({ db: supabase, ownerId: user.id, artistId: artist.artistId }),
  ]);

  const firstError = [releasesResult, tracksResult, campaignsResult, tasksResult, automationResult, publicationResult, contentResult, learningsResult, soundCloudPendingResult, spotifyPendingResult, outreachDraftsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const tracks = tracksResult.data ?? [];
  const campaigns = campaignsResult.data ?? [];
  const content = contentResult.data ?? [];
  const publications = publicationResult.data ?? [];
  const activeRelease = releases.find((release) => release.active_release)
    ?? releases.find((release) => release.release_date && release.release_date >= now.toISOString().slice(0, 10))
    ?? releases[0]
    ?? null;
  const missingAssets = content.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
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
  const activeDistribution = activeRelease ? await loadDistributionArtistState(supabase, user.id, artist.artistId, activeRelease.id) : null;

  const workflowApprovalCount = (automationResult.data ?? []).filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length
    + publications.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length;
  const unmatchedCount = [...(soundCloudPendingResult.data ?? []), ...(spotifyPendingResult.data ?? [])].filter((row) => !row.linked_track_id).length;
  const dueTasks = (tasksResult.data ?? []).filter((task) => task.due_at && new Date(task.due_at) <= sevenDays);

  const queue = deriveNeedsYouQueue({
    activeReleaseId: activeRelease?.id ?? null,
    activeMission,
    distributionDecisions: activeRelease ? (activeDistribution?.decisions ?? []).map((decision) => ({ key: decision.key, title: decision.title, detail: decision.detail, severity: decision.severity, releaseId: activeRelease.id })) : [],
    paidGrowthDecisions: paidGrowthNeedsYou(paidWorkspace.cards),
    workflowApprovalCount,
    outreachDraftCount: outreachDraftsResult.data?.length ?? 0,
    manualReady: publications.filter((job) => String(job.status) === "manual_ready").map((job) => ({ id: job.id, platform: job.platform, contentItemId: job.content_item_id })),
    unmatchedCount,
    missingAssets: missingAssets.map((asset) => ({ id: asset.id, title: asset.title, platform: asset.platform, scheduledLabel: shortDate(asset.scheduled_at), releaseId: asset.release_id })),
    dueTasks: dueTasks.map((task) => ({ id: task.id, title: task.title, priority: task.priority, dueLabel: dateDistance(task.due_at) })),
    proposedLearningCount: learningsResult.data?.length ?? 0,
  });
  const required = queue.filter((item) => item.severity === "required");
  const review = queue.filter((item) => item.severity !== "required");
  const renderDecision = (entry: (typeof queue)[number]) => (
    <DecisionRow
      href={href(entry.href)}
      key={entry.id}
      meta={`${entry.category} · ${entry.severity}`}
      title={entry.title}
      description={entry.detail}
      tone={decisionTone(needsYouTone(entry))}
    />
  );

  return (
    <div className="studio-v2-page needs-you-page">
      <PageHeader title="Needs You" description={`Only decisions that genuinely require ${artist.artistName}'s judgment.`} action={<Link className="button" href={href("/studio")}>Back to Today</Link>} />

      <PriorityHero
        eyebrow="Decision queue"
        title={queue.length ? `${queue.length} decision${queue.length === 1 ? "" : "s"} worth your attention` : "Ensemblis can keep moving"}
        description={queue.length ? "Release blockers and spend stop conditions come first, then external effects, ambiguity and review work. Resolve the source action and the queue updates automatically." : "Nothing currently needs human judgment. Safe internal work can continue without manufacturing tasks."}
        status={required.length ? "Blocked" : queue.length ? "Needs attention" : "Clear"}
        tone={required.length ? "danger" : queue.length ? "attention" : "success"}
      />

      {required.length ? <DecisionQueue eyebrow="Required now" title="Blocking decisions" count={required.length}>{required.map(renderDecision)}</DecisionQueue> : null}

      {review.length ? <DecisionQueue eyebrow={required.length ? "Then review" : "Decisions"} title={required.length ? "Everything else" : "Needs you"} count={review.length}>{review.map(renderDecision)}</DecisionQueue> : null}

      {!queue.length ? <CalmState title="Nothing needs your judgment right now." body="Approvals, ambiguity, release blockers and trustworthy learning decisions will appear here automatically." /> : null}
    </div>
  );
}
