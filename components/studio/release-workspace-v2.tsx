import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ObjectHeader } from "@/components/studio/object-header";
import { ReleaseForm } from "@/components/studio/release-form";
import { ReleaseMasterAudioPanel } from "@/components/studio/release-master-audio-panel";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { lifecycleLabel, releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { deriveReleaseMission } from "@/lib/studio/release-mission";
import type { ContentItem, MetricSnapshot, Release, Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

const STAGES = ["overview", "music", "content", "promotion", "distribution", "results"] as const;
type Stage = (typeof STAGES)[number];
type CampaignSummary = { id:string; name:string; status:string; mode:string; objective:string; primary_kpi:string } | null;
type PlaybookTask = { id:string; title:string; status:string; priority:string; due_at:string | null };

function normalizeStage(stage: string): Stage {
  if (stage === "plan") return "promotion";
  if (stage === "create") return "content";
  if (stage === "publish") return "distribution";
  if (stage === "learn") return "results";
  return STAGES.includes(stage as Stage) ? stage as Stage : "overview";
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", { month:"short", day:"numeric", year:"numeric", timeZone:"Europe/Berlin" }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
}

function total(rows: MetricSnapshot[], key: keyof MetricSnapshot) {
  return rows.reduce((sum,row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
}

function resultInsight(metrics: MetricSnapshot[]) {
  const streams = total(metrics, "streams");
  const listeners = total(metrics, "listeners");
  const saves = total(metrics, "saves");
  if (!streams && !listeners) return "Performance evidence will appear here once listening data is available.";
  if (listeners > 0 && saves / listeners >= 0.15) return "Listeners are saving this release at a strong rate. Keep the song-led creative in rotation instead of changing direction too quickly.";
  if (listeners > 0 && streams / listeners >= 2) return "Repeat listening is visible. Ensemblis should protect the creative angles already sending people back to the song.";
  return "There is listening activity, but not enough durable intent yet to declare a winning creative angle. Keep testing from the strongest musical Moments.";
}

export function ReleaseWorkspaceV2({ release, tracks, contentItems, metrics, campaign, stage, renderedAt, artistId, playbookTasks = [], providerScheduledCount = 0, vaultTrack = null }: {
  release: Release;
  tracks: Track[];
  contentItems: ContentItem[];
  metrics: MetricSnapshot[];
  campaign: CampaignSummary;
  stage: string;
  renderedAt: string;
  artistId: string;
  playbookTasks?: PlaybookTask[];
  providerScheduledCount?: number;
  vaultTrack?: VaultTrack | null;
}) {
  const href = (path: string) => ensemblisArtistHref(path, artistId);
  const renderTime = new Date(renderedAt);
  const lifecycle = releaseLifecycle({ releaseDate: release.release_date, status: release.status, isArchived: release.is_archived }, renderTime);
  const activeStage = normalizeStage(stage);
  const releaseWorkActive = activeStage === "content" || activeStage === "promotion" || activeStage === "distribution";
  const now = renderTime.getTime();
  const planned = contentItems.filter((item) => item.scheduled_at && item.status !== "Published" && Date.parse(item.scheduled_at) >= now - 3_600_000).sort((a,b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const scheduled = contentItems.filter((item) => item.status === "Scheduled");
  const missingAsset = contentItems.filter((item) => item.scheduled_at && Date.parse(item.scheduled_at) >= now - 3_600_000 && !item.asset_url && item.status !== "Published");
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0] ?? null;
  const hasMasterAudio = Boolean(primaryTrack?.audio_url || vaultTrack?.audio_url);
  const releaseDateLocked = providerScheduledCount > 0;
  const openPlaybook = playbookTasks.filter((task) => !["Done", "Skipped"].includes(task.status));
  const mission = deriveReleaseMission({
    releaseId: release.id,
    lifecycle,
    releaseDate: release.release_date,
    hasMasterAudio,
    hasArtwork: Boolean(release.artwork_url || release.cover_asset),
    hasCampaign: Boolean(campaign),
    missingAssetTitles: missingAsset.map((item) => item.title),
    hasListeningDestination: Boolean(release.smart_link_url || release.spotify_url || release.soundcloud_url || release.youtube_url),
    hasPrimaryHook: Boolean(release.primary_hook),
    providerScheduledCount,
  });
  const missionAttention = [...mission.blockers, ...mission.recommendations];
  const nextMissionItem = missionAttention[0] ?? mission.optional[0] ?? null;
  const streams = total(metrics, "streams");
  const listeners = total(metrics, "listeners");
  const saves = total(metrics, "saves");
  const playlistAdds = total(metrics, "playlist_adds");
  const topTabs = [
    { label: "Overview", href: href(`/studio/releases/${release.id}?stage=overview`), active: activeStage === "overview" },
    { label: "Music", href: href(`/studio/releases/${release.id}?stage=music`), active: activeStage === "music" },
    { label: "Release work", href: href(`/studio/releases/${release.id}?stage=promotion`), active: releaseWorkActive },
    { label: "Results", href: href(`/studio/releases/${release.id}?stage=results`), active: activeStage === "results" },
  ];

  return <div className="studio-v2-page release-workspace-v2 release-object-workspace ensemblis-release-mission">
    <ObjectHeader
      backHref={href("/studio/releases")}
      backLabel="Releases"
      eyebrow={lifecycleLabel(lifecycle)}
      title={release.title}
      subtitle={`${release.release_type} · ${shortDate(release.release_date)}`}
      imageUrl={release.artwork_url}
      imageAlt={release.cover_alt || `${release.title} artwork`}
      facts={[
        { label: "Mission", value: mission.label },
        { label: "Needs attention", value: missionAttention.length },
        { label: "Tracks", value: tracks.length },
        { label: "Content", value: contentItems.length },
      ]}
      tabs={topTabs}
    />

    {releaseWorkActive ? <nav className="release-work-subnav" aria-label="Release work">
      <Link href={href(`/studio/releases/${release.id}?stage=content`)} aria-current={activeStage === "content" ? "page" : undefined} className={activeStage === "content" ? "is-active" : undefined}>Content</Link>
      <Link href={href(`/studio/releases/${release.id}?stage=promotion`)} aria-current={activeStage === "promotion" ? "page" : undefined} className={activeStage === "promotion" ? "is-active" : undefined}>Promotion</Link>
      <Link href={href(`/studio/releases/${release.id}?stage=distribution`)} aria-current={activeStage === "distribution" ? "page" : undefined} className={activeStage === "distribution" ? "is-active" : undefined}>Distribution</Link>
    </nav> : null}

    {activeStage === "overview" ? <div className="release-mission-overview">
      <section className="release-mission-hero" data-status={mission.status}>
        <div>
          <span className="section-label">Release Mission</span>
          <h2>{mission.status === "blocked" ? "This release needs one thing before Ensemblis can move it forward" : mission.status === "needs_attention" ? "This release is moving. A few useful decisions remain." : "This release is on track"}</h2>
          <p>{mission.summary}</p>
        </div>
        {nextMissionItem ? <Link className="button primary" href={href(nextMissionItem.href)}>{nextMissionItem.title}</Link> : <Link className="button primary" href={href(`/studio/create?release=${release.id}`)}>Create next asset</Link>}
      </section>

      <section className="release-mission-checklist" aria-label="Release readiness">
        <div><span className={hasMasterAudio ? "is-ready" : ""} aria-hidden>●</span><strong>Music</strong><small>{hasMasterAudio ? "Master ready" : "Master needed"}</small></div>
        <div><span className={release.artwork_url || release.cover_asset ? "is-ready" : ""} aria-hidden>●</span><strong>Identity</strong><small>{release.artwork_url || release.cover_asset ? "Artwork ready" : "Artwork needed"}</small></div>
        <div><span className={campaign ? "is-ready" : ""} aria-hidden>●</span><strong>Promotion</strong><small>{campaign ? "Plan active" : "Plan preparing"}</small></div>
        <div><span className={release.smart_link_url || release.spotify_url || release.soundcloud_url || release.youtube_url ? "is-ready" : ""} aria-hidden>●</span><strong>Listening</strong><small>{release.smart_link_url || release.spotify_url || release.soundcloud_url || release.youtube_url ? "Destination ready" : "Destination needed"}</small></div>
      </section>

      {missionAttention.length ? <section className="today-v3-section">
        <div className="v2-section-heading compact"><div><span className="section-label">Next decisions</span><h2>Only what can change the release</h2></div><span className="v2-count has-items">{missionAttention.length}</span></div>
        <div className="v2-inbox">{missionAttention.map((item) => <Link className="v2-inbox-item" href={href(item.href)} key={item.key}><div><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div>
      </section> : <div className="v2-calm-state compact"><strong>No release decision is waiting.</strong><p>Ensemblis has enough coherent music, release identity and operating context to keep moving.</p></div>}

      {!release.artwork_url && !release.cover_asset ? <section className="v2-section" id="cover-upload"><div className="v2-section-heading"><div><span className="section-label">Release identity</span><h2>Add the cover artwork</h2></div></div><MediaUploader releaseId={release.id} artistId={artistId} defaultRole="cover" /></section> : null}

      <details className="v2-advanced-disclosure release-source-details" id="release-details">
        <summary>Release details</summary>
        <p className="v2-muted-copy">Canonical facts Ensemblis uses across distribution, content and promotion.</p>
        <ReleaseForm release={release} releaseDateLocked={releaseDateLocked} />
      </details>

      <details className="v2-advanced-disclosure release-specialist-tools">
        <summary>Specialist tools</summary>
        <p className="v2-muted-copy">Legacy migration, exceptional provider controls and debugging tools. Normal release work should not require this workspace.</p>
        <Link className="button" href={href(`/studio/releases/${release.id}?view=advanced`)}>Open specialist workspace</Link>
      </details>
    </div> : null}

    {activeStage === "music" ? <div className="release-music-workspace">
      <section className="v2-section release-stage-intro-card">
        <div className="v2-section-heading"><div><span className="section-label">Music first</span><h2>The master and the strongest Moments are the creative source of truth</h2><p>Track, lyric and stem intelligence stay attached to the music. Marketing tools consume that evidence instead of asking you to restate the song.</p></div></div>
      </section>
      <ReleaseMasterAudioPanel releaseId={release.id} primaryTrack={primaryTrack} vaultTrack={vaultTrack} />
      <section className="release-track-summary">
        {tracks.map((track) => <Link href={href(`/studio/music/${(track.is_primary || tracks.length === 1) && vaultTrack ? vaultTrack.id : track.id}`)} key={track.id}><span>{track.is_primary ? "Primary track" : "Track"}</span><strong>{track.title}</strong><small>{track.audio_url ? "Audio ready · open intelligence" : "Audio source needed"}</small><b aria-hidden>→</b></Link>)}
      </section>
      <div className="release-moments-anchor"><span className="section-label">Best Moments</span><p>Ensemblis shows only a small editorial selection of complete, usable musical passages below.</p></div>
    </div> : null}

    {activeStage === "content" ? <div className="release-content-workspace">
      <section className="release-stage-intro-card v2-section"><div className="v2-section-heading"><div><span className="section-label">Content</span><h2>Make deliverables from the music, not content for its own sake</h2><p>Ensemblis carries the approved Moment, lyrics, stems, artist memory and release context into production automatically.</p></div><Link className="button primary" href={href(`/studio/create?release=${release.id}`)}>Create something</Link></div></section>
      <div className="v2-create-grid release-deliverable-grid">
        <Link className="v2-create-card" href={href(`/studio/create?release=${release.id}`)}><span className="section-label">Fast social creative</span><h2>Reels, lyric cuts and visual loops</h2><p>Choose the deliverable. Ensemblis picks the strongest musical source.</p><strong>Open Create →</strong></Link>
        <Link className="v2-create-card" href={href(`/studio/video?release=${release.id}`)}><span className="section-label">Longer motion</span><h2>Video Director</h2><p>Build a coherent music-video world when the release needs more than a social cut.</p><strong>Direct video →</strong></Link>
        <Link className="v2-create-card" href={href(`/studio/production?release=${release.id}`)}><span className="section-label">In progress</span><h2>Production</h2><p>Refine and approve only assets already connected to this release.</p><strong>Open production →</strong></Link>
      </div>
      <section className="release-content-status">
        <div><strong>{contentItems.length}</strong><span>content items</span></div>
        <div><strong>{planned.length}</strong><span>planned next</span></div>
        <div><strong>{missingAsset.length}</strong><span>need an asset</span></div>
      </section>
    </div> : null}

    {activeStage === "promotion" ? <div className="release-promotion-workspace">
      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Promotion</span><h2>{lifecycle === "catalog" ? "Give this release a reason to be discovered again" : lifecycle === "launch_window" ? "Keep the live release moving while the signal is fresh" : "One promotion plan, anchored to the music and release date"}</h2></div><Link href={href("/studio/growth")}>Open Grow</Link></div>
        {campaign ? <div className="release-promotion-plan"><div><span>{campaign.status}</span><h3>{campaign.name}</h3><p>{campaign.objective} · success signal: {campaign.primary_kpi}</p></div><Link className="button" href={href(`/studio/campaigns/${campaign.id}`)}>Advanced campaign controls</Link></div> : <div className="v2-calm-state compact"><strong>Ensemblis is preparing the promotion plan.</strong><p>The manager creates the campaign shell from release context. You do not need to configure a campaign engine before useful work can begin.</p></div>}
        <div className="v2-plan-timeline">{planned.length ? planned.slice(0,12).map((item) => <Link href={href(`/studio/production?edit=${item.id}`)} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform} · {item.status}</small></Link>) : <p className="v2-muted-copy">Future promotion work will appear here as Ensemblis schedules it. Historical missed moments are not recreated as overdue debt.</p>}</div>
      </section>
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Release playbook</span><h2>{openPlaybook.length} meaningful checkpoint{openPlaybook.length === 1 ? "" : "s"}</h2></div></div>
        {openPlaybook.length ? <div className="release-playbook-list">{openPlaybook.slice(0,10).map((task) => <div key={task.id}><span>{task.due_at ? shortDate(task.due_at) : "When ready"}</span><strong>{task.title}</strong><small>{task.priority}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>No promotion checkpoint is waiting.</strong><p>Completed and lifecycle-skipped work stays out of the active release.</p></div>}
      </section>
    </div> : null}

    {activeStage === "distribution" ? <section className="v2-section release-distribution-workspace">
      <div className="v2-section-heading"><div><span className="section-label">Distribution</span><h2>Get the music live, then keep every listening path coherent</h2><p>DSP delivery, public destinations and campaign publishing belong to this release. Specialist provider controls stay one level deeper.</p></div></div>
      <div className="v2-publish-grid">
        <article><span>Music distribution</span><strong>DSP delivery</strong><small>Readiness, rights, provenance, stores and delivery status</small><Link href={href(`/studio/releases/${release.id}/distribution`)}>Open delivery →</Link></article>
        <article><span>Listening destination</span><strong>{[release.spotify_url,release.soundcloud_url,release.youtube_url].filter(Boolean).length}/3 linked</strong><small>Spotify, SoundCloud and YouTube</small><Link href={href(`/studio/releases/${release.id}?view=advanced&tab=music`)}>Manage destinations →</Link></article>
        <article><span>Artist web</span><strong>{release.publish_state === "live" ? "Live" : "Not live"}</strong><small>Public catalog and release presence</small><Link href={href(`/studio/releases/${release.id}?view=advanced&tab=website`)}>Website controls →</Link></article>
        <article><span>Campaign publishing</span><strong>{releaseDateLocked ? `${providerScheduledCount} scheduled` : `${scheduled.length} ready`}</strong><small>{missingAsset.length ? `${missingAsset.length} still need assets` : "No asset blocker detected"}</small><Link href={href(`/studio/production?release=${release.id}`)}>Open production →</Link></article>
      </div>
    </section> : null}

    {activeStage === "results" ? <section className="v2-section release-results-workspace">
      <div className="v2-section-heading"><div><span className="section-label">Results</span><h2>What the release is teaching us</h2><p>Numbers matter when they change the next decision. Ensemblis turns release evidence into a recommendation instead of leaving you with a dashboard to interpret.</p></div><Link href={href("/studio/growth?view=performance")}>Open performance</Link></div>
      <div className="v2-status-grid">
        <article><strong>{streams.toLocaleString()}</strong><span>streams</span><small>Recorded snapshots</small></article>
        <article><strong>{listeners.toLocaleString()}</strong><span>listeners</span><small>Unique audience signal</small></article>
        <article><strong>{saves.toLocaleString()}</strong><span>saves</span><small>Retention intent</small></article>
        <article><strong>{playlistAdds.toLocaleString()}</strong><span>playlist adds</span><small>Durable catalog intent</small></article>
      </div>
      <div className="release-result-insight"><span className="section-label">Ensemblis read</span><strong>{resultInsight(metrics)}</strong><div className="actions"><Link className="button primary" href={href("/studio/growth?view=opportunities")}>Review opportunities</Link><Link className="button" href={href("/studio/memory")}>What Ensemblis learned</Link></div></div>
    </section> : null}
  </div>;
}
