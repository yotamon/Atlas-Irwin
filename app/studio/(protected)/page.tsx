import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { asMarketingClient } from "@/lib/marketing/db";
import { releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { deriveReleaseMission } from "@/lib/studio/release-mission";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "Europe/Berlin",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
}

function shortDateTime(value: string | null | undefined) {
  if (!value) return "Time not set";
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function dateDistance(value: string | null | undefined) {
  if (!value) return "Date not set";
  const target = new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime();
  const days = Math.ceil((target - Date.now()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  const ago = Math.abs(days);
  return `${ago} day${ago === 1 ? "" : "s"} ago`;
}

function actionHref(action: { action_type: string }) {
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

type TodayItem = {
  id: string;
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
  tone?: "normal" | "important" | "warning";
};

type WorkingItem = {
  id: string;
  title: string;
  detail: string;
  status: "Queued" | "Working" | "Publishing";
  href: string;
};

type ComingUpItem = {
  id: string;
  title: string;
  detail: string;
  scheduledAt: string;
  href: string;
};

export default async function TodayPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const marketing = asMarketingClient(supabase);
  const autonomy = createAutonomyServiceClient();
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
    nextActionsResult,
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
  ] = await Promise.all([
    music
      .from("releases")
      .select("id,title,release_date,active_release,artwork_url,cover_asset,primary_hook,smart_link_url,spotify_url,soundcloud_url,youtube_url,status,is_archived")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .order("updated_at", { ascending: false }),
    music
      .from("tracks")
      .select("id,release_id,audio_url,is_primary")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId),
    marketing
      .from("campaigns")
      .select("id,release_id,status")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "eq", "archived"),
    operational
      .from("tasks")
      .select("id,title,due_at,priority,status")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "in", '("Done","Skipped")')
      .order("due_at", { ascending: true })
      .limit(30),
    marketing
      .from("automation_jobs")
      .select("id,campaign_id,job_type,status,approval_status,run_after")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "in", '("completed","failed","cancelled")')
      .order("run_after", { ascending: true })
      .limit(40),
    marketing
      .from("publication_jobs")
      .select("id,campaign_id,content_item_id,platform,status,approval_status,scheduled_at")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "in", '("published","failed","cancelled")')
      .order("scheduled_at", { ascending: true })
      .limit(40),
    marketing
      .from("content_items")
      .select("id,title,platform,status,asset_url,scheduled_at,release_id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .not("status", "eq", "Archived")
      .order("scheduled_at", { ascending: true })
      .limit(100),
    marketing
      .from("marketing_learnings")
      .select("id,status")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("status", "proposed")
      .limit(20),
    autonomy
      .from("next_best_actions")
      .select("id,title,rationale,action_type,score,status")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .eq("status", "proposed")
      .order("score", { ascending: false })
      .limit(8),
    supabase
      .from("soundcloud_tracks")
      .select("id,linked_track_id")
      .eq("owner_id", user.id)
      .eq("reconcile_status", "pending"),
    supabase
      .from("spotify_tracks")
      .select("id,linked_track_id")
      .eq("owner_id", user.id)
      .eq("reconcile_status", "pending"),
    marketing
      .from("outreach_messages")
      .select("id")
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .is("sent_at", null)
      .eq("response_status", "Draft"),
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

  const workflowApprovalCount = automation.filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  ).length + publications.filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  ).length;
  const manualReady = publications.filter((job) => String(job.status) === "manual_ready");
  const unmatched = [
    ...(soundCloudPendingResult.data ?? []),
    ...(spotifyPendingResult.data ?? []),
  ].filter((item) => !item.linked_track_id).length;
  const missingAssets = content.filter(
    (item) => item.scheduled_at && !item.asset_url && item.status !== "Published",
  );
  const proposedLearningCount = learningsResult.data?.length ?? 0;
  const dueTasks = (tasksResult.data ?? []).filter(
    (task) => task.due_at && new Date(task.due_at) <= sevenDays,
  );
  const outreachDraftCount = outreachDraftsResult.data?.length ?? 0;

  const activeReleaseContent = activeRelease ? content.filter((item) => item.release_id === activeRelease.id) : [];
  const activeReleaseContentIds = new Set(activeReleaseContent.map((item) => item.id));
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

  const needsYou: TodayItem[] = [
    ...(workflowApprovalCount ? [{
      id: "approvals",
      eyebrow: "Approval",
      title: `${workflowApprovalCount} workflow approval${workflowApprovalCount === 1 ? "" : "s"} ready`,
      detail: "Review the external effects Ensemblis has prepared for you.",
      href: href("/studio/inbox"),
      tone: "important" as const,
    }] : []),
    ...(outreachDraftCount ? [{
      id: "outreach",
      eyebrow: "Outreach",
      title: `${outreachDraftCount} message${outreachDraftCount === 1 ? "" : "s"} prepared`,
      detail: "Approve delivery or use the prepared manual handoff.",
      href: href("/studio/inbox"),
      tone: "important" as const,
    }] : []),
    ...manualReady.slice(0, 1).map((job) => ({
      id: `manual-${job.id}`,
      eyebrow: "Ready for handoff",
      title: `${job.platform} is prepared`,
      detail: "Everything is ready for the final manual publishing step.",
      href: href(job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/inbox"),
      tone: "warning" as const,
    })),
    ...(unmatched ? [{
      id: "unmatched",
      eyebrow: "Needs matching",
      title: `${unmatched} catalog match${unmatched === 1 ? "" : "es"} need a decision`,
      detail: "Ensemblis found an ambiguous platform match and left the judgment to you.",
      href: href("/studio/data-health?category=unmatched"),
      tone: "warning" as const,
    }] : []),
    ...missingAssets.slice(0, 2).map((item) => ({
      id: `asset-${item.id}`,
      eyebrow: "Creative",
      title: `${item.title} is waiting for its asset`,
      detail: `${item.platform}${item.scheduled_at ? ` · ${shortDate(item.scheduled_at)}` : ""}`,
      href: href(`/studio/production?edit=${item.id}`),
      tone: "normal" as const,
    })),
    ...dueTasks.slice(0, 2).map((task) => ({
      id: `task-${task.id}`,
      eyebrow: "Task",
      title: task.title,
      detail: task.due_at ? `${task.priority} · ${dateDistance(task.due_at)}` : task.priority,
      href: href(activeRelease ? `/studio/releases/${activeRelease.id}` : "/studio/releases"),
      tone: "normal" as const,
    })),
    ...(proposedLearningCount ? [{
      id: "learnings",
      eyebrow: "Learning",
      title: `${proposedLearningCount} evidence-backed insight${proposedLearningCount === 1 ? "" : "s"} to review`,
      detail: `Only approved findings become future memory for ${artist.artistName}.`,
      href: href("/studio/learn"),
      tone: "normal" as const,
    }] : []),
  ].slice(0, 7);

  const working: WorkingItem[] = [
    ...automation
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => ({
        id: `automation-${job.id}`,
        title: humanizeJobType(job.job_type),
        detail: job.run_after ? `Started from the automation plan · ${shortDateTime(job.run_after)}` : "Autonomous workflow",
        status: job.status === "running" ? "Working" as const : "Queued" as const,
        href: href("/studio/growth"),
      })),
    ...publications
      .filter((job) => String(job.status) === "publishing")
      .map((job) => ({
        id: `publication-${job.id}`,
        title: `Publishing to ${job.platform}`,
        detail: job.scheduled_at ? shortDateTime(job.scheduled_at) : "Publication in progress",
        status: "Publishing" as const,
        href: href(job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/growth"),
      })),
  ].slice(0, 6);

  const scheduledPublications = publications.filter((job) =>
    ["approved", "scheduled", "provider_scheduled"].includes(String(job.status))
    && job.scheduled_at
    && new Date(job.scheduled_at) >= now
    && new Date(job.scheduled_at) <= sevenDays,
  );
  const publicationContentIds = new Set(
    scheduledPublications.map((job) => job.content_item_id).filter(Boolean),
  );
  const upcomingContent = content.filter((item) =>
    item.scheduled_at
    && new Date(item.scheduled_at) >= now
    && new Date(item.scheduled_at) <= sevenDays
    && !publicationContentIds.has(item.id),
  );
  const comingUp: ComingUpItem[] = [
    ...scheduledPublications.map((job) => ({
      id: `scheduled-publication-${job.id}`,
      title: `${job.platform} publication`,
      detail: "Scheduled and ready to move",
      scheduledAt: job.scheduled_at!,
      href: href(job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/growth"),
    })),
    ...upcomingContent.map((item) => ({
      id: `scheduled-content-${item.id}`,
      title: item.title,
      detail: `${item.platform} content`,
      scheduledAt: item.scheduled_at!,
      href: href(`/studio/production?edit=${item.id}`),
    })),
  ]
    .sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime())
    .slice(0, 7);

  return (
    <div className="studio-v2-page ensemblis-today-v3">
      <PageHeader
        title="Today"
        description={`A calm command center for ${artist.artistName}. See the active Mission, what Ensemblis is doing, and only the decisions that need you.`}
        action={needsYou.length ? (
          <Link className="button primary" href={href("/studio/inbox")}>
            Needs you ({needsYou.length})
          </Link>
        ) : undefined}
      />

      {activeRelease && activeMission ? (
        <section className="today-v3-next" aria-labelledby="today-mission-heading">
          <div className="today-v3-section-heading">
            <div>
              <span className="section-label">Active release Mission</span>
              <h2 id="today-mission-heading">{activeRelease.title}</h2>
            </div>
            <Status>{activeMission.label}</Status>
          </div>
          <p>{activeMission.summary}</p>
          <div className="actions">
            {activeMission.nextAction ? (
              <Link className="button primary" href={href(activeMission.nextAction.href)}>
                {activeMission.nextAction.title}
              </Link>
            ) : (
              <Link className="button primary" href={href(`/studio/releases/${activeRelease.id}`)}>Open Mission</Link>
            )}
            <Link className="today-v3-secondary-link" href={href(`/studio/releases/${activeRelease.id}`)}>
              View release Mission
            </Link>
          </div>
        </section>
      ) : null}

      <section className="today-v3-next" aria-labelledby="today-next-heading">
        <div className="today-v3-section-heading">
          <div>
            <span className="section-label">Next best action</span>
            <h2 id="today-next-heading">
              {nextAction?.title || "Ensemblis can keep moving without interrupting you"}
            </h2>
          </div>
          <Status>{nextAction ? `${Math.round(Number(nextAction.score))}/100 signal` : "Clear"}</Status>
        </div>

        {nextAction ? (
          <>
            <p>{nextAction.rationale}</p>
            <div className="actions">
              <Link className="button primary" href={href(actionHref(nextAction))}>
                Act on this
              </Link>
              <Link className="today-v3-secondary-link" href={href("/studio/growth")}>
                Inspect evidence
              </Link>
            </div>
          </>
        ) : (
          <div className="today-v3-calm-state">
            <strong>No higher-leverage human intervention is currently ranked.</strong>
            <p>Ensemblis will continue safe internal work and surface anything that requires judgment or an external effect.</p>
          </div>
        )}
      </section>

      <div className="today-v3-two-column">
        <section className="today-v3-section" aria-labelledby="today-needs-you-heading">
          <div className="today-v3-section-heading compact">
            <div>
              <span className="section-label">Decision queue</span>
              <h2 id="today-needs-you-heading">Needs you</h2>
            </div>
            <span className={`today-v3-count${needsYou.length ? " has-items" : ""}`}>{needsYou.length}</span>
          </div>

          {needsYou.length ? (
            <div className="today-v3-list">
              {needsYou.map((item) => (
                <Link
                  className={`today-v3-row ${item.tone ?? "normal"}`}
                  href={item.href}
                  key={item.id}
                >
                  <span className="today-v3-row-copy">
                    <small>{item.eyebrow}</small>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </span>
                  <span className="today-v3-arrow" aria-hidden>→</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="today-v3-calm-state compact">
              <strong>Nothing needs your judgment right now.</strong>
              <p>Approvals, ambiguity and important decisions will appear here.</p>
            </div>
          )}
        </section>

        <section className="today-v3-section" aria-labelledby="today-working-heading">
          <div className="today-v3-section-heading compact">
            <div>
              <span className="section-label">Autonomous work</span>
              <h2 id="today-working-heading">Working</h2>
            </div>
            <span className={`today-v3-count${working.length ? " is-working" : ""}`}>{working.length}</span>
          </div>

          {working.length ? (
            <div className="today-v3-list">
              {working.map((item) => (
                <Link className="today-v3-work-row" href={item.href} key={item.id}>
                  <span className="today-v3-working-dot" aria-hidden />
                  <span className="today-v3-row-copy">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </span>
                  <Status>{item.status}</Status>
                </Link>
              ))}
            </div>
          ) : (
            <div className="today-v3-calm-state compact">
              <strong>No active background work.</strong>
              <p>When Ensemblis starts analysis, generation or publishing work, it will be visible here.</p>
            </div>
          )}
        </section>
      </div>

      <section className="today-v3-section today-v3-upcoming" aria-labelledby="today-coming-up-heading">
        <div className="today-v3-section-heading compact">
          <div>
            <span className="section-label">Next 7 days</span>
            <h2 id="today-coming-up-heading">Coming up</h2>
          </div>
          <Link className="today-v3-secondary-link" href={href("/studio/growth")}>Open Grow</Link>
        </div>

        {comingUp.length ? (
          <div className="today-v3-list">
            {comingUp.map((item) => (
              <Link className="today-v3-upcoming-row" href={item.href} key={item.id}>
                <time dateTime={item.scheduledAt}>{shortDateTime(item.scheduledAt)}</time>
                <span className="today-v3-row-copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </span>
                <span className="today-v3-arrow" aria-hidden>→</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="today-v3-calm-state compact inline">
            <strong>The next seven days are clear.</strong>
            <p>Scheduled content and publications will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}
