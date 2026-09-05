import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { deriveNeedsYouQueue, needsYouTone } from "@/lib/studio/needs-you";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { deriveReleaseMission } from "@/lib/studio/release-mission";

function shortDate(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
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

export default async function NeedsYouPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const marketing = asMarketingClient(supabase);
  const now = new Date();
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);

  const [
    releasesResult,
    tracksResult,
    campaignsResult,
    tasksResult,
    automationResult,
    publicationResult,
    contentResult,
    learningsResult,
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
  ] = await Promise.all([
    music.from("releases")
      .select("id,title,release_date,active_release,artwork_url,cover_asset,primary_hook,smart_link_url,spotify_url,soundcloud_url,youtube_url,status,is_archived")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    music.from("tracks").select("id,release_id,audio_url,is_primary")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId),
    marketing.from("campaigns").select("id,release_id,status")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "eq", "archived"),
    operational.from("tasks").select("id,title,due_at,priority,status")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .not("status", "in", '("Done","Skipped")').order("due_at", { ascending: true }).limit(30),
    marketing.from("automation_jobs").select("id,status,approval_status")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .not("status", "in", '("completed","failed","cancelled")').limit(60),
    marketing.from("publication_jobs").select("id,content_item_id,platform,status,approval_status,scheduled_at")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .not("status", "in", '("published","failed","cancelled")').order("scheduled_at", { ascending: true }).limit(60),
    marketing.from("content_items").select("id,title,platform,status,asset_url,scheduled_at,release_id")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId)
      .not("status", "eq", "Archived").order("scheduled_at", { ascending: true }).limit(120),
    marketing.from("marketing_learnings").select("id,status")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "proposed").limit(40),
    supabase.from("soundcloud_tracks").select("id,linked_track_id")
      .eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("id,linked_track_id")
      .eq("owner_id", user.id).eq("reconcile_status", "pending"),
    marketing.from("outreach_messages").select("id")
      .eq("owner_id", user.id).eq("artist_id", artist.artistId).is("sent_at", null).eq("response_status", "Draft"),
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
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
  ].find((result) => result.error)?.error;
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
  const activeReleaseContentIds = new Set(
    activeRelease ? content.filter((item) => item.release_id === activeRelease.id).map((item) => item.id) : [],
  );
  const activeProviderScheduledCount = publications.filter(
    (job) => job.content_item_id && activeReleaseContentIds.has(job.content_item_id) && String(job.status) === "provider_scheduled",
  ).length;
  const activeMission = activeRelease ? deriveReleaseMission({
    releaseId: activeRelease.id,
    lifecycle: releaseLifecycle({
      releaseDate: activeRelease.release_date,
      status: activeRelease.status,
      isArchived: activeRelease.is_archived,
    }, now),
    releaseDate: activeRelease.release_date,
    hasMasterAudio: tracks.some((track) => track.release_id === activeRelease.id && Boolean(track.audio_url)),
    hasArtwork: Boolean(activeRelease.artwork_url || activeRelease.cover_asset),
    hasCampaign: campaigns.some((campaign) => campaign.release_id === activeRelease.id),
    missingAssetTitles: missingAssets.filter((item) => item.release_id === activeRelease.id).map((item) => item.title),
    hasListeningDestination: Boolean(activeRelease.smart_link_url || activeRelease.spotify_url || activeRelease.soundcloud_url || activeRelease.youtube_url),
    hasPrimaryHook: Boolean(activeRelease.primary_hook),
    providerScheduledCount: activeProviderScheduledCount,
  }) : null;

  const workflowApprovalCount = (automationResult.data ?? []).filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  ).length + publications.filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  ).length;
  const unmatchedCount = [
    ...(soundCloudPendingResult.data ?? []),
    ...(spotifyPendingResult.data ?? []),
  ].filter((row) => !row.linked_track_id).length;
  const dueTasks = (tasksResult.data ?? []).filter((task) => task.due_at && new Date(task.due_at) <= sevenDays);

  const queue = deriveNeedsYouQueue({
    activeReleaseId: activeRelease?.id ?? null,
    activeMission,
    workflowApprovalCount,
    outreachDraftCount: outreachDraftsResult.data?.length ?? 0,
    manualReady: publications
      .filter((job) => String(job.status) === "manual_ready")
      .map((job) => ({ id: job.id, platform: job.platform, contentItemId: job.content_item_id })),
    unmatchedCount,
    missingAssets: missingAssets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      platform: asset.platform,
      scheduledLabel: shortDate(asset.scheduled_at),
      releaseId: asset.release_id,
    })),
    dueTasks: dueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dueLabel: dateDistance(task.due_at),
    })),
    proposedLearningCount: learningsResult.data?.length ?? 0,
  });

  return (
    <div className="studio-v2-page ensemblis-today-v3">
      <PageHeader
        title="Needs You"
        description={`Every decision that genuinely requires ${artist.artistName}'s judgment, gathered from canonical Mission, approval, creative, catalog and learning state.`}
        action={<Link className="button" href={href("/studio")}>Back to Today</Link>}
      />

      <section className="today-v3-next">
        <div className="today-v3-section-heading">
          <div>
            <span className="section-label">Universal decision queue</span>
            <h2>{queue.length ? `${queue.length} decision${queue.length === 1 ? "" : "s"} worth interrupting you for` : "Ensemblis can keep moving"}</h2>
          </div>
          <Status>{queue.some((item) => item.severity === "required") ? "Blocked" : queue.length ? "Needs attention" : "Clear"}</Status>
        </div>
        <p>{queue.length ? "Required Mission blockers come first, then external-effect decisions, ambiguity and review work. The queue is derived from source state rather than maintained as a second task system." : "Nothing currently needs human judgment. Safe internal work can continue without manufacturing tasks."}</p>
      </section>

      <section className="today-v3-section" aria-labelledby="needs-you-list-heading">
        <div className="today-v3-section-heading compact">
          <div><span className="section-label">Decisions</span><h2 id="needs-you-list-heading">Needs you</h2></div>
          <span className={`today-v3-count${queue.length ? " has-items" : ""}`}>{queue.length}</span>
        </div>
        {queue.length ? (
          <div className="today-v3-list">
            {queue.map((entry) => (
              <Link className={`today-v3-row ${needsYouTone(entry)}`} href={href(entry.href)} key={entry.id}>
                <span className="today-v3-row-copy">
                  <small>{entry.category} · {entry.severity}</small>
                  <strong>{entry.title}</strong>
                  <span>{entry.detail}</span>
                </span>
                <span className="today-v3-arrow" aria-hidden>→</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="today-v3-calm-state">
            <strong>Nothing needs your judgment right now.</strong>
            <p>Approvals, ambiguity, release blockers and trustworthy learning decisions will appear here automatically.</p>
          </div>
        )}
      </section>

      <section className="v2-section v2-compact-section">
        <div className="v2-section-heading"><div><span className="section-label">Contract</span><h2>One queue, no duplicate tasks</h2></div></div>
        <p className="v2-muted-copy">Needs You is a projection over canonical product state. Resolving the source action removes the item. Ensemblis does not create a second checklist that can drift away from Releases, publishing, catalog reconciliation or learning evidence.</p>
      </section>
    </div>
  );
}
