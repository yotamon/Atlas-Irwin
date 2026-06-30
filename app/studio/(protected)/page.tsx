import Link from "next/link";
import { publishRelease } from "@/app/studio/catalog-actions";
import { EmptyState, PageHeader, Status } from "@/components/studio/ui";
import { HomepageCatalogPreview } from "@/components/studio/homepage-catalog-preview";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { getPublicReleases } from "@/lib/public-catalog";
import { publishStateLabel } from "@/lib/studio/catalog-labels";
import { calculateReleaseReadiness } from "@/lib/studio/readiness";
import type {
  ContentItem,
  HomepagePlacement,
  MediaAsset,
  MediaLink,
  MetricSnapshot,
  Release,
  ReleaseExternalLink,
  Track,
} from "@/types/database";

const METRICS = [
  ["streams", "Plays"],
  ["saves", "Saves"],
  ["follows", "Follows"],
  ["profile_visits", "Profile visits"],
  ["link_clicks", "Link clicks"],
  ["views", "Content views"],
] as const;

function shortDate(value: string | null) {
  if (!value) return "Date not set";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
}

function metricTotal(rows: MetricSnapshot[], key: (typeof METRICS)[number][0]) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function deltaLabel(current: number, previous: number) {
  if (!previous) return current ? "New this week" : "No change";
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta > 0 ? "+" : ""}${delta}% vs last week`;
}

function percent(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function relativeSync(value: string | null | undefined) {
  if (!value) return "Not synced yet";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60000));
  if (minutes < 2) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  return `Synced ${Math.round(hours / 24)}d ago`;
}

export default async function CommandCenter() {
  const { supabase, user } = await requireStudioAdmin();
  const now = new Date();
  const sevenDays = new Date(now);
  sevenDays.setDate(now.getDate() + 7);
  const previousWeek = new Date(now);
  previousWeek.setDate(now.getDate() - 14);

  const [
    releasesResult,
    tracksResult,
    placementsResult,
    mediaAssetsResult,
    mediaLinksResult,
    externalLinksResult,
    soundCloudResult,
    spotifyResult,
    contentResult,
    followupsResult,
    tasksResult,
    metricsResult,
    soundCloudAccountResult,
    spotifyAccountResult,
  ] = await Promise.all([
    supabase.from("releases").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("tracks").select("*").eq("owner_id", user.id).order("display_order"),
    supabase.from("homepage_placements").select("*").eq("owner_id", user.id).order("display_order"),
    supabase.from("media_assets").select("*").eq("owner_id", user.id),
    supabase.from("media_links").select("*").eq("owner_id", user.id),
    supabase.from("release_external_links").select("*").eq("owner_id", user.id),
    supabase.from("soundcloud_tracks").select("*").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("*").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("content_items").select("*").eq("owner_id", user.id).order("scheduled_at", { ascending: true }),
    supabase.from("outreach_messages").select("*,outreach_contacts(name)").eq("owner_id", user.id).order("follow_up_at"),
    supabase.from("tasks").select("*").eq("owner_id", user.id).neq("status", "Done").order("due_at"),
    supabase.from("metric_snapshots").select("*").eq("owner_id", user.id).gte("date", previousWeek.toISOString().slice(0, 10)).order("date"),
    supabase.from("soundcloud_accounts").select("last_synced_at").eq("owner_id", user.id).maybeSingle(),
    supabase.from("spotify_accounts").select("last_synced_at").eq("owner_id", user.id).maybeSingle(),
  ]);

  const releases = (releasesResult.data ?? []) as Release[];
  const tracks = (tracksResult.data ?? []) as Track[];
  const placements = (placementsResult.data ?? []) as HomepagePlacement[];
  const mediaAssets = (mediaAssetsResult.data ?? []) as MediaAsset[];
  const mediaLinks = (mediaLinksResult.data ?? []) as MediaLink[];
  const externalLinks = (externalLinksResult.data ?? []) as ReleaseExternalLink[];
  const content = (contentResult.data ?? []) as ContentItem[];
  const metrics = (metricsResult.data ?? []) as MetricSnapshot[];
  const active = releases.find((release) => release.active_release) ?? releases[0] ?? null;
  const activeTracks = active ? tracks.filter((track) => track.release_id === active.id) : [];
  const activePlacement = active ? placements.find((placement) => placement.release_id === active.id) ?? null : null;
  const activeLinks = active ? mediaLinks.filter((link) => link.release_id === active.id) : [];
  const activeAssetIds = new Set(activeLinks.map((link) => link.media_asset_id));
  const activeAssets = mediaAssets.filter((asset) => activeAssetIds.has(asset.id));
  const activeContent = active ? content.filter((item) => item.release_id === active.id) : [];
  const publicReleases = await getPublicReleases();
  const unmatched = [...(soundCloudResult.data ?? []), ...(spotifyResult.data ?? [])].filter(
    (item) => !item.linked_track_id,
  );
  const readiness = active
    ? calculateReleaseReadiness({
        release: active,
        tracks: activeTracks,
        placement: activePlacement,
        mediaAssets: activeAssets,
        mediaLinks: activeLinks,
        externalLinks: externalLinks.filter((link) => link.release_id === active.id),
        content: activeContent,
        unresolvedConflicts: unmatched.length,
      })
    : null;

  const attention = [
    ...(unmatched.length
      ? [{ title: `${unmatched.length} unmatched external track${unmatched.length === 1 ? "" : "s"}`, detail: "SoundCloud or Spotify records need an explicit catalog decision.", href: "/studio/data-health?category=unmatched", level: "critical" }]
      : []),
    ...releases
      .filter((release) => release.publish_state === "live" && !release.artwork_url)
      .map((release) => ({ title: `${release.title} is live without cover art`, detail: "Attach an intentional public cover before promoting it.", href: `/studio/releases/${release.id}?tab=media`, level: "critical" })),
    ...releases
      .filter((release) => release.publish_state === "live" && !placements.some((placement) => placement.release_id === release.id && placement.enabled))
      .map((release) => ({ title: `${release.title} is live but absent from the homepage`, detail: "Place it on the homepage or intentionally keep it catalog-only.", href: `/studio/releases/${release.id}?tab=website`, level: "warning" })),
    ...placements
      .filter((placement) => placement.enabled && !placement.default_track_id)
      .map((placement) => ({ title: `${releases.find((release) => release.id === placement.release_id)?.title ?? "A homepage release"} has no default player track`, detail: "Choose the exact track the public player should open with.", href: `/studio/releases/${placement.release_id}?tab=website`, level: "critical" })),
    ...content
      .filter((item) => item.status === "Scheduled" && !item.asset_url)
      .map((item) => ({ title: `${item.title} is scheduled without an asset`, detail: `${item.platform} · ${item.scheduled_at ? shortDate(item.scheduled_at.slice(0, 10)) : "date pending"}`, href: `/studio/content?edit=${item.id}`, level: "warning" })),
    ...(active && readiness && !readiness.items.find((item) => item.id === "campaign-assets")?.complete
      ? [{ title: "Active campaign needs a motion or social asset", detail: "Add a vertical video, visualizer, canvas, or social image.", href: `/studio/releases/${active.id}?tab=media`, level: "recommendation" }]
      : []),
  ].slice(0, 7);

  const upcomingContent = content.filter((item) => {
    if (!item.scheduled_at) return false;
    const date = new Date(item.scheduled_at);
    return date >= now && date <= sevenDays;
  });
  const upcomingReleases = releases.filter((release) => {
    if (!release.release_date) return false;
    const date = new Date(`${release.release_date}T23:59:59`);
    return date >= now && date <= sevenDays;
  });
  const dueFollowups = (followupsResult.data ?? []).filter((item) => {
    if (!item.follow_up_at) return false;
    const date = new Date(item.follow_up_at);
    return date >= now && date <= sevenDays;
  });
  const dueTasks = (tasksResult.data ?? []).filter((item) => {
    if (!item.due_at) return false;
    const date = new Date(item.due_at);
    return date >= now && date <= sevenDays;
  });
  const weekItems = [
    ...upcomingContent.map((item) => ({ date: item.scheduled_at!, title: item.title, meta: `${item.platform} · ${item.status}`, href: `/studio/content?edit=${item.id}` })),
    ...upcomingReleases.map((release) => ({ date: `${release.release_date}T12:00:00`, title: `${release.title} release date`, meta: release.publish_state, href: `/studio/releases/${release.id}` })),
    ...dueFollowups.map((item) => ({ date: item.follow_up_at!, title: `Follow up with ${(item.outreach_contacts as unknown as { name: string } | null)?.name ?? "contact"}`, meta: item.channel, href: `/studio/outreach/${item.contact_id}` })),
    ...dueTasks.map((item) => ({ date: item.due_at!, title: item.title, meta: `${item.priority} priority`, href: active ? `/studio/releases/${active.id}?tab=campaign` : "/studio/campaigns" })),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 7);
  const currentMetrics = metrics.filter((row) => new Date(`${row.date}T12:00:00`) >= thisWeekStart);
  const previousMetrics = metrics.filter((row) => new Date(`${row.date}T12:00:00`) < thisWeekStart);
  const currentTotals = Object.fromEntries(METRICS.map(([key]) => [key, metricTotal(currentMetrics, key)])) as Record<(typeof METRICS)[number][0], number>;
  const previousTotals = Object.fromEntries(METRICS.map(([key]) => [key, metricTotal(previousMetrics, key)])) as Record<(typeof METRICS)[number][0], number>;
  const liveReleases = releases.filter((release) => release.publish_state === "live" && release.is_public).length;
  const scheduledCount = content.filter((item) => item.status === "Scheduled").length;
  const openTasks = tasksResult.data?.length ?? 0;
  const primaryAction = attention[0] ?? (active && readiness?.recommendations[0]
    ? { title: readiness.recommendations[0].label, detail: readiness.recommendations[0].detail, href: readiness.recommendations[0].href, level: "recommendation" }
    : active
      ? { title: "Build the next campaign action", detail: "Turn the active release into one concrete piece of scheduled content.", href: `/studio/releases/${active.id}?tab=campaign`, level: "recommendation" }
      : { title: "Create your first release", detail: "Start a release workspace to unlock planning, publishing, and performance tracking.", href: "/studio/releases/new", level: "recommendation" });

  return (
    <>
      <PageHeader
        title="Command Center"
        description={`${new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(now)} · A focused view of your release operation.`}
        action={
          <div className="actions">
            <Link className="button primary" href={active ? `/studio/releases/${active.id}?tab=campaign` : "/studio/releases/new"}>
              {active ? "Create campaign content" : "Create release"}
            </Link>
            <Link className="button" href="/studio/data-health">Review data health</Link>
          </div>
        }
      />

      <section className="command-overview" aria-label="Studio overview">
        <Link href={active ? `/studio/releases/${active.id}#readiness` : "/studio/releases/new"}>
          <span>Active readiness</span>
          <strong>{readiness ? `${readiness.score}%` : "—"}</strong>
          <small>{readiness ? `${readiness.blockers.length} blocking issue${readiness.blockers.length === 1 ? "" : "s"}` : "No active release"}</small>
        </Link>
        <Link href="/studio/releases">
          <span>Public catalog</span>
          <strong>{liveReleases}</strong>
          <small>{releases.length} total release{releases.length === 1 ? "" : "s"}</small>
        </Link>
        <Link href="/studio/campaigns?view=calendar">
          <span>Next 7 days</span>
          <strong>{weekItems.length}</strong>
          <small>{scheduledCount} content item{scheduledCount === 1 ? "" : "s"} scheduled</small>
        </Link>
        <Link href="/studio/analytics">
          <span>Weekly plays</span>
          <strong>{currentTotals.streams.toLocaleString()}</strong>
          <small className={currentTotals.streams >= previousTotals.streams ? "positive" : "negative"}>{deltaLabel(currentTotals.streams, previousTotals.streams)}</small>
        </Link>
        <Link href="/studio/data-health">
          <span>Open workload</span>
          <strong>{attention.length + openTasks}</strong>
          <small>{attention.length} issue{attention.length === 1 ? "" : "s"} · {openTasks} task{openTasks === 1 ? "" : "s"}</small>
        </Link>
      </section>

      <section className={`next-action ${primaryAction.level}`} aria-labelledby="next-action-title">
        <div className="next-action-marker" aria-hidden>01</div>
        <div>
          <span className="section-label">Next best action</span>
          <h2 id="next-action-title">{primaryAction.title}</h2>
          <p>{primaryAction.detail}</p>
        </div>
        <Link className="button primary" href={primaryAction.href}>Take action <span aria-hidden>→</span></Link>
      </section>

      {active ? (
        <section className="command-release" aria-labelledby="active-release-title">
          <div className="command-artwork">
            {active.artwork_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.artwork_url} alt={active.cover_alt || `${active.title} artwork`} />
            ) : <div className="empty-orbit" />}
          </div>
          <div className="command-release-copy">
            <span className="section-label">Active release</span>
            <div className="catalog-card-badges">
              <Status>{publishStateLabel(active.publish_state)}</Status>
              <Status>{active.is_public ? "Public" : "Private"}</Status>
              {activePlacement?.enabled ? <Status>On homepage</Status> : null}
            </div>
            <h2 id="active-release-title">{active.title}</h2>
            <p>{active.story || active.core_emotion || "Give this release a story so every campaign decision has a center."}</p>
            <dl className="release-facts">
              <div><dt>Release date</dt><dd>{shortDate(active.release_date)}</dd></div>
              <div><dt>Player opens with</dt><dd>{activeTracks.find((track) => track.id === activePlacement?.default_track_id)?.title || activeTracks.find((track) => track.is_primary)?.title || "Not selected"}</dd></div>
            </dl>
            <div className="form-actions">
              <Link className="button primary" href={`/studio/releases/${active.id}`}>Open workspace</Link>
              <Link className="button" href={`/?preview=${active.slug}#music`} target="_blank">Preview public appearance</Link>
              <Link className="button" href={`/studio/releases/${active.id}?tab=website`}>Edit homepage</Link>
              {readiness?.canPublish ? (
                <form action={publishRelease}>
                  <input type="hidden" name="release_id" value={active.id} />
                  <input type="hidden" name="publish_state" value={active.publish_state === "live" ? "draft" : "live"} />
                  <input type="hidden" name="is_public" value={active.publish_state === "live" ? "" : "on"} />
                  <button className="button">{active.publish_state === "live" ? "Unpublish" : "Publish"}</button>
                </form>
              ) : null}
            </div>
          </div>
          {readiness ? (
            <Link className="readiness-dial" href={`/studio/releases/${active.id}#readiness`} aria-label={`Release readiness ${readiness.score} percent`}>
              <strong>{readiness.score}</strong><span>% ready</span>
              <small>{readiness.blockers.length} blocker{readiness.blockers.length === 1 ? "" : "s"}</small>
            </Link>
          ) : null}
        </section>
      ) : (
        <EmptyState title="Choose the next release" body="Create a release workspace, then make it active to focus the Studio." href="/studio/releases/new" label="Create release" />
      )}

      <div className="command-layout">
        <section className="command-section attention-queue">
          <div className="section-head"><div><span className="section-label">Needs attention</span><h2>Decisions, not notifications</h2></div><Link href="/studio/data-health">See all</Link></div>
          {attention.length ? attention.map((item, index) => (
            <Link className="attention-row" href={item.href} key={`${item.title}-${index}`}>
              <span className={`attention-index ${item.level}`}>{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              <span aria-hidden>Fix →</span>
            </Link>
          )) : <EmptyState title="Everything is aligned" body="No catalog, website, or campaign issues need action." />}
        </section>

        <section className="command-section homepage-preview">
          <div className="section-head"><div><span className="section-label">Homepage live preview</span><h2>What listeners see now</h2></div><Link href={active ? `/studio/releases/${active.id}?tab=website` : "/studio/releases"}>Edit</Link></div>
          <div className="live-preview-frame"><HomepageCatalogPreview releases={publicReleases} /></div>
          <div className="placement-strip">
            {placements.filter((placement) => placement.enabled).map((placement) => {
              const release = releases.find((item) => item.id === placement.release_id);
              return <Link href={`/studio/releases/${placement.release_id}?tab=website`} key={placement.id}><span>{placement.display_order + 1}</span>{release?.title ?? "Missing release"}<small>{placement.placement_type}</small></Link>;
            })}
          </div>
        </section>

        <section className="command-section week-rail">
          <div className="section-head"><div><span className="section-label">This week</span><h2>Seven-day runway</h2></div><Link href="/studio/campaigns?view=calendar">Calendar</Link></div>
          {weekItems.length ? weekItems.map((item) => (
            <Link className="week-row" href={item.href} key={`${item.date}-${item.title}`}>
              <time dateTime={item.date}>{new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric" }).format(new Date(item.date))}</time>
              <span><strong>{item.title}</strong><small>{item.meta}</small></span>
            </Link>
          )) : <EmptyState title="Clear runway" body="Schedule content, follow-ups, or campaign actions to shape the week." href={active ? `/studio/releases/${active.id}?tab=campaign` : "/studio/campaigns"} label="Plan the week" />}
        </section>

        <section className="command-section performance-pulse">
          <div className="section-head"><div><span className="section-label">Performance pulse</span><h2>Signals worth watching</h2></div><Link href="/studio/analytics">Details</Link></div>
          {metrics.length ? (
            <div className="pulse-grid">
              {METRICS.map(([key, label]) => {
                const current = currentTotals[key];
                const previous = previousTotals[key];
                return <div key={key}><span>{label}</span><strong>{current.toLocaleString()}</strong><small className={current > previous ? "positive" : undefined}>{deltaLabel(current, previous)}</small></div>;
              })}
            </div>
          ) : <EmptyState title="No performance snapshots yet" body="Connect SoundCloud or add a manual snapshot. The Studio will stay quiet until real data exists." href="/studio/analytics#new" label="Add snapshot" />}
          {metrics.length ? (
            <div className="signal-strip" aria-label="Weekly conversion signals">
              <div><span>View → save</span><strong>{percent(currentTotals.saves, currentTotals.views)}</strong></div>
              <div><span>Visit → follow</span><strong>{percent(currentTotals.follows, currentTotals.profile_visits)}</strong></div>
              <div><span>View → click</span><strong>{percent(currentTotals.link_clicks, currentTotals.views)}</strong></div>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="data-freshness" aria-label="Connected data freshness">
        <div><span className={spotifyAccountResult.data ? "source-dot connected" : "source-dot"} /> <strong>Spotify</strong><small>{spotifyAccountResult.data ? relativeSync(spotifyAccountResult.data.last_synced_at) : "Not connected"}</small></div>
        <div><span className={soundCloudAccountResult.data ? "source-dot connected" : "source-dot"} /> <strong>SoundCloud</strong><small>{soundCloudAccountResult.data ? relativeSync(soundCloudAccountResult.data.last_synced_at) : "Not connected"}</small></div>
        <div className="freshness-note"><span>Reporting window</span><strong>Last 7 days</strong><small>Compared with the prior 7 days</small></div>
        <Link href="/studio/data-health">Review data sources →</Link>
      </footer>
    </>
  );
}
