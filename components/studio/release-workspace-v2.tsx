/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ObjectHeader } from "@/components/studio/object-header";
import { ReleaseForm } from "@/components/studio/release-form";
import { ReleaseMasterAudioPanel } from "@/components/studio/release-master-audio-panel";
import { lifecycleLabel, releaseLifecycle, type ReleaseLifecycle } from "@/lib/marketing/release-lifecycle";
import type { ContentItem, MediaAsset, MediaLink, MetricSnapshot, Release, Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

const STAGE_KEYS = ["overview","plan","create","publish","learn"] as const;
type Stage = (typeof STAGE_KEYS)[number];
type CampaignSummary = { id:string; name:string; status:string; mode:string; objective:string; primary_kpi:string } | null;
type PlaybookTask = { id:string; title:string; status:string; priority:string; due_at:string | null };

function stagesFor(lifecycle: ReleaseLifecycle) {
  if (lifecycle === "catalog") return [["overview","Orient"],["plan","Rediscover"],["create","Produce"],["publish","Distribute"],["learn","Learn"]] as const;
  if (lifecycle === "launch_window") return [["overview","Orient"],["plan","Continue"],["create","Produce"],["publish","Distribute"],["learn","Learn"]] as const;
  if (lifecycle === "development") return [["overview","Select"],["plan","Prepare"],["create","Develop"],["publish","Release"],["learn","Sustain"]] as const;
  return [["overview","Select"],["plan","Prepare"],["create","Build hype"],["publish","Release"],["learn","Sustain"]] as const;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", { month:"short", day:"numeric", year:"numeric", timeZone:"Europe/Berlin" }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
}
function total(rows: MetricSnapshot[], key: keyof MetricSnapshot) {
  return rows.reduce((sum,row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
}
function healthScore({
  release,
  hasMasterAudio,
  campaign,
  contentItems,
  missingAssets,
}: {
  release: Release;
  hasMasterAudio: boolean;
  campaign: CampaignSummary;
  contentItems: ContentItem[];
  missingAssets: ContentItem[];
}) {
  let score = 0;
  if (release.release_date) score += 15;
  if (hasMasterAudio) score += 20;
  if (release.artwork_url || release.cover_asset) score += 15;
  if (campaign) score += 15;
  if (contentItems.length >= 4) score += 15;
  else score += Math.min(12, contentItems.length * 3);
  if (contentItems.length && missingAssets.length === 0) score += 10;
  else if (contentItems.length) score += Math.max(0, 10 - missingAssets.length * 2);
  if (release.spotify_url || release.smart_link_url) score += 5;
  if (release.primary_hook) score += 5;
  return Math.min(100, score);
}

export function ReleaseWorkspaceV2({ release, tracks, mediaLinks, mediaAssets, contentItems, metrics, campaign, stage, renderedAt, playbookTasks = [], providerScheduledCount = 0, vaultTrack = null }: {
  release: Release; tracks: Track[]; mediaLinks: MediaLink[]; mediaAssets: MediaAsset[]; contentItems: ContentItem[]; metrics: MetricSnapshot[]; campaign: CampaignSummary; stage: string; renderedAt: string; playbookTasks?: PlaybookTask[]; providerScheduledCount?: number; vaultTrack?: VaultTrack | null;
}) {
  const renderTime = new Date(renderedAt);
  const lifecycle = releaseLifecycle({ releaseDate: release.release_date, status: release.status, isArchived: release.is_archived }, renderTime);
  const stages = stagesFor(lifecycle);
  const activeStage: Stage = STAGE_KEYS.some((key) => key === stage) ? stage as Stage : "overview";
  const activeStageIndex = STAGE_KEYS.findIndex((key) => key === activeStage);
  const releaseMediaIds = new Set(mediaLinks.map((link) => link.media_asset_id));
  const releaseAssets = mediaAssets.filter((asset) => releaseMediaIds.has(asset.id));
  const now = renderTime.getTime();
  const planned = contentItems.filter((item) => item.scheduled_at && item.status !== "Published" && Date.parse(item.scheduled_at) >= now - 3_600_000).sort((a,b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const scheduled = contentItems.filter((item) => item.status === "Scheduled");
  const missingAsset = contentItems.filter((item) => item.scheduled_at && Date.parse(item.scheduled_at) >= now - 3_600_000 && !item.asset_url && item.status !== "Published");
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0] ?? null;
  const hasMasterAudio = Boolean(primaryTrack?.audio_url || vaultTrack?.audio_url);
  const releaseDateLocked = providerScheduledCount > 0;
  const openPlaybook = playbookTasks.filter((task) => !["Done", "Skipped"].includes(task.status));
  const score = healthScore({ release, hasMasterAudio, campaign, contentItems, missingAssets: missingAsset });
  const needsYou = [
    ...(!release.release_date && lifecycle !== "catalog" ? [{ title:"Choose a release date", detail:"Ensemblis needs one anchor date before it can schedule an upcoming release workflow.", href:"#release-details" }] : []),
    ...(releaseDateLocked ? [{ title:"External schedule is active", detail:`${providerScheduledCount} post${providerScheduledCount === 1 ? " is" : "s are"} already scheduled at a provider, so the release date is locked against drift.`, href:"?stage=publish" }] : []),
    ...(!hasMasterAudio ? [{ title:"Add the release master", detail:"Upload the canonical audio so Ensemblis can analyze sections and hooks for this release.", href:"#master-audio" }] : []),
    ...(!release.artwork_url && !release.cover_asset ? [{ title:"Choose cover artwork", detail:"Upload it here and Ensemblis will attach it as the release cover automatically.", href:"#cover-upload" }] : []),
    ...(!campaign ? [{ title:"Growth execution needs repair", detail:"Ensemblis normally creates the campaign shell automatically. Open Campaign Brain only if the self-healing heartbeat cannot restore it.", href:"/studio/campaigns" }] : []),
    ...missingAsset.slice(0,2).map((item) => ({ title:`Finish ${item.title}`, detail:`${item.platform} has a future planned date but still needs the creative asset.`, href:`/studio/production?edit=${item.id}` })),
  ];
  const planTitle = lifecycle === "catalog"
    ? "A current rediscovery plan, starting from today"
    : lifecycle === "launch_window"
      ? "Continue the live release from today"
      : "One growth plan, anchored to release day";

  return <div className="studio-v2-page release-workspace-v2 release-object-workspace">
    <ObjectHeader
      backHref="/studio/releases"
      backLabel="Releases"
      eyebrow={lifecycleLabel(lifecycle)}
      title={release.title}
      subtitle={`${release.release_type} · ${shortDate(release.release_date)}`}
      imageUrl={release.artwork_url}
      imageAlt={release.cover_alt || `${release.title} artwork`}
      facts={[
        { label: "Workflow readiness", value: `${score}%` },
        { label: "Current workflow", value: `Phase ${activeStageIndex + 1} of 5 · ${stages[activeStageIndex]?.[1]}` },
        { label: "Tracks", value: tracks.length },
        { label: "Content", value: contentItems.length },
      ]}
      actions={<Link className="button" href={`/studio/releases/${release.id}?view=advanced`}>Advanced view</Link>}
      tabs={stages.map(([key,label]) => ({ label, href: `/studio/releases/${release.id}?stage=${key}`, active: activeStage === key }))}
    />

    {activeStage === "overview" ? <div className="v2-release-layout release-object-overview">
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Orient</span><h2>{needsYou.length ? `${needsYou.length} thing${needsYou.length===1?"":"s"} need attention` : "Ensemblis has enough context to keep moving"}</h2></div><span className={`v2-count ${needsYou.length?"has-items":""}`}>{needsYou.length}</span></div>
        {needsYou.length ? <div className="v2-inbox">{needsYou.map((item) => <Link className="v2-inbox-item" href={item.href} key={`${item.title}-${item.href}`}><div><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div> : <div className="v2-calm-state compact"><strong>Ensemblis has what it needs.</strong><p>The track, release identity and operating context are coherent enough to continue.</p></div>}
      </section>
      <aside className="v2-release-summary-card release-object-summary"><dl><div><dt>Tracks</dt><dd>{tracks.length}</dd></div><div><dt>Assets</dt><dd>{releaseAssets.length}</dd></div><div><dt>Content</dt><dd>{contentItems.length}</dd></div><div><dt>Readiness</dt><dd>{score}%</dd></div></dl></aside>
      <ReleaseMasterAudioPanel releaseId={release.id} primaryTrack={primaryTrack} vaultTrack={vaultTrack} />
      {!release.artwork_url && !release.cover_asset ? <section className="v2-section v2-full-column" id="cover-upload"><div className="v2-section-heading"><div><span className="section-label">Identity</span><h2>Drop the cover artwork here</h2></div></div><MediaUploader releaseId={release.id} defaultRole="cover" /></section> : null}
      <section className="v2-section v2-full-column" id="release-details"><div className="v2-section-heading"><div><span className="section-label">Source of truth</span><h2>Only the release facts Ensemblis must anchor around</h2></div></div><ReleaseForm release={release} releaseDateLocked={releaseDateLocked} /></section>
    </div> : null}

    {activeStage === "plan" ? <div className="release-prepare-grid">
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">{stages[1][1]}</span><h2>{planTitle}</h2></div></div>
        {campaign ? <div className="v2-plan-card"><div><span>{campaign.status} · {campaign.mode}</span><h3>{campaign.name}</h3><p>Objective: {campaign.objective} · Primary signal: {campaign.primary_kpi}</p></div><Link className="button" href={`/studio/campaigns/${campaign.id}`}>Inspect campaign engine</Link></div> : <div className="v2-calm-state compact"><strong>The campaign shell is missing.</strong><p>The normal marketing heartbeat repairs this automatically. Use Campaign Brain only for exceptional debugging or strategy overrides.</p><Link className="button" href="/studio/campaigns">Inspect Campaign Brain</Link></div>}
        <div className="v2-plan-timeline">{planned.length ? planned.slice(0,12).map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform} · {item.status}</small></Link>) : <p className="v2-muted-copy">Ensemblis will populate only future, connected-channel work. Missed historical moments are never recreated as overdue debt.</p>}</div>
      </section>
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Release playbook</span><h2>{openPlaybook.length} open checkpoint{openPlaybook.length === 1 ? "" : "s"}</h2></div><Link href="/studio/calendar">Timeline</Link></div>
        {openPlaybook.length ? <div className="release-playbook-list">{openPlaybook.slice(0,10).map((task) => <div key={task.id}><span>{task.due_at ? shortDate(task.due_at) : "When ready"}</span><strong>{task.title}</strong><small>{task.priority}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>No actionable checkpoint is waiting.</strong><p>Completed and lifecycle-skipped work stays out of the active workflow.</p></div>}
      </section>
    </div> : null}

    {activeStage === "create" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">{stages[2][1]}</span><h2>Scale one coherent creative world, not filler</h2></div></div><p className="v2-muted-copy release-stage-intro">Ensemblis starts from the strongest available music, lyric, stem and visual context. Paid generation stays approval-gated; routine production should derive from the campaign need rather than manufacture unrelated posts.</p><div className="v2-create-grid">
      <Link className="v2-create-card" href="/studio/music?view=generate"><span className="section-label">Audio</span><h2>Create music</h2><p>Develop edits or audio ideas only when the release strategy actually needs them.</p><strong>Open music creation →</strong></Link>
      <Link className="v2-create-card" href={`/studio/video?release=${release.id}`}><span className="section-label">Motion</span><h2>Video Director</h2><p>Produce a coherent music-video world with cost checkpoints before paid generation.</p><strong>Open Video Director →</strong></Link>
      <Link className="v2-create-card" href={`/studio/production?release=${release.id}`}><span className="section-label">Campaign creative</span><h2>Production queue</h2><p>Generate, refine and approve only the assets attached to measurable campaign moments.</p><strong>Open production →</strong></Link>
    </div></section> : null}

    {activeStage === "publish" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">{stages[3][1]}</span><h2>{lifecycle === "catalog" ? "Keep the music discoverable without pretending it just launched" : "Ship the music and the winning discovery system together"}</h2></div><Link href="/studio/inbox">Needs you</Link></div><div className="v2-publish-grid">
      <article><span>Music distribution</span><strong>DSP delivery</strong><small>Readiness, rights, AI provenance, stores and delivery status</small><Link href={`/studio/releases/${release.id}/distribution`}>Open Distribution →</Link></article>
      <article><span>Website</span><strong>{release.publish_state === "live" ? "Live" : "Not live"}</strong><small>Public catalog state</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=website`}>Website controls →</Link></article>
      <article><span>Listening links</span><strong>{[release.spotify_url,release.soundcloud_url,release.youtube_url].filter(Boolean).length}/3</strong><small>Spotify, SoundCloud, YouTube</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=music`}>Destinations →</Link></article>
      <article><span>Campaign publishing</span><strong>{planned.length}</strong><small>{releaseDateLocked ? `${providerScheduledCount} scheduled at provider` : missingAsset.length ? `${missingAsset.length} still need assets` : `${scheduled.length} ready/scheduled`}</small><Link href={`/studio/production?release=${release.id}`}>Production →</Link></article>
    </div><div className="growth-action-note release-day-note"><strong>Distribution principle</strong><span>Music delivery and marketing distribution are separate systems. Get the release safely onto DSPs, then scale only the discovery angles that create real music intent, saves and follows.</span></div></section> : null}

    {activeStage === "learn" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">{stages[4][1]}</span><h2>Keep the release alive while the signal is useful</h2></div><Link href="/studio/growth?view=opportunities">Catalog opportunities</Link></div><div className="v2-status-grid">
      <article><strong>{total(metrics,"streams").toLocaleString()}</strong><span>streams</span><small>Recorded snapshots</small></article><article><strong>{total(metrics,"listeners").toLocaleString()}</strong><span>listeners</span><small>Unique audience signal</small></article><article><strong>{total(metrics,"saves").toLocaleString()}</strong><span>saves</span><small>Retention intent</small></article><article><strong>{total(metrics,"playlist_adds").toLocaleString()}</strong><span>playlist adds</span><small>Durable catalog intent</small></article>
    </div><div className="v2-calm-state compact"><strong>Launch week is not the finish line.</strong><p>Ensemblis watches for catalog revival and breakout creative signals. Only approved learnings become memory for the next release.</p><div className="actions"><Link className="button primary" href="/studio/growth?view=opportunities">Scan portfolio opportunities</Link><Link className="button" href="/studio/learn">Learning memory</Link></div></div></section> : null}
  </div>;
}
