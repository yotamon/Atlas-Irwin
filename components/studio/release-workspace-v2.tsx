import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ReleaseForm } from "@/components/studio/release-form";
import { ReleaseMasterAudioPanel } from "@/components/studio/release-master-audio-panel";
import type { ContentItem, MediaAsset, MediaLink, MetricSnapshot, Release, Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

const STAGES = [["overview","Select"],["plan","Prepare"],["create","Build hype"],["publish","Release"],["learn","Sustain"]] as const;
type Stage = (typeof STAGES)[number][0];
type CampaignSummary = { id:string; name:string; status:string; mode:string; objective:string; primary_kpi:string } | null;
type PlaybookTask = { id:string; title:string; status:string; priority:string; due_at:string | null };

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

export function ReleaseWorkspaceV2({ release, tracks, mediaLinks, mediaAssets, contentItems, metrics, campaign, stage, playbookTasks = [], providerScheduledCount = 0, vaultTrack = null }: {
  release: Release; tracks: Track[]; mediaLinks: MediaLink[]; mediaAssets: MediaAsset[]; contentItems: ContentItem[]; metrics: MetricSnapshot[]; campaign: CampaignSummary; stage: string; playbookTasks?: PlaybookTask[]; providerScheduledCount?: number; vaultTrack?: VaultTrack | null;
}) {
  const activeStage: Stage = STAGES.some(([key]) => key === stage) ? stage as Stage : "overview";
  const activeStageIndex = STAGES.findIndex(([key]) => key === activeStage);
  const releaseMediaIds = new Set(mediaLinks.map((link) => link.media_asset_id));
  const releaseAssets = mediaAssets.filter((asset) => releaseMediaIds.has(asset.id));
  const planned = contentItems.filter((item) => item.scheduled_at).sort((a,b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const scheduled = contentItems.filter((item) => item.status === "Scheduled");
  const missingAsset = contentItems.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0] ?? null;
  const hasMasterAudio = Boolean(primaryTrack?.audio_url || vaultTrack?.audio_url);
  const releaseDateLocked = providerScheduledCount > 0;
  const openPlaybook = playbookTasks.filter((task) => task.status !== "Done");
  const score = healthScore({ release, hasMasterAudio, campaign, contentItems, missingAssets: missingAsset });
  const needsYou = [
    ...(!release.release_date ? [{ title:"Choose a release date", detail:"Atlas needs one anchor date to move the whole plan.", href:"#release-details" }] : []),
    ...(releaseDateLocked ? [{ title:"External schedule is active", detail:`${providerScheduledCount} post${providerScheduledCount === 1 ? " is" : "s are"} already scheduled at a provider, so the release date is locked against drift.`, href:"?stage=publish" }] : []),
    ...(!hasMasterAudio ? [{ title:"Add the release master", detail:"Upload the canonical audio so Atlas can analyze sections and hooks for this release.", href:"#master-audio" }] : []),
    ...(!release.artwork_url && !release.cover_asset ? [{ title:"Choose cover artwork", detail:"Upload it here and Atlas will attach it as the release cover automatically.", href:"#cover-upload" }] : []),
    ...(!campaign ? [{ title:"Create the growth plan", detail:"Connect this release to Campaign Brain so content, experiments and attribution share one objective.", href:"/studio/campaigns" }] : []),
    ...missingAsset.slice(0,2).map((item) => ({ title:`Finish ${item.title}`, detail:`${item.platform} has a planned date but still needs the creative asset.`, href:`/studio/production?edit=${item.id}` })),
  ];

  return <div className="studio-v2-page release-workspace-v2">
    <header className="v2-release-header">
      <div><Link className="v2-back-link" href="/studio/growth#queue">← Portfolio plan</Link><div className="v2-release-title-row"><h1>{release.title}</h1><span>{release.status}</span></div><p>{release.release_type} · {shortDate(release.release_date)}</p></div>
      <div className="actions"><Link className="button" href={`/studio/releases/${release.id}?view=advanced`}>Advanced view</Link></div>
    </header>

    <section className="release-growth-status">
      <div><span className="section-label">Release health</span><strong>{score}%</strong><small>{needsYou.length ? `${needsYou.length} blocker${needsYou.length === 1 ? "" : "s"} need attention` : "Atlas can keep moving"}</small></div>
      <div className="release-health-meter" aria-label={`Release health ${score}%`}><span style={{ width: `${score}%` }} /></div>
      <div><span className="section-label">Current workflow</span><strong>Phase {activeStageIndex + 1} of 5</strong><small>{STAGES[activeStageIndex]?.[1]}</small></div>
    </section>

    <nav className="v2-stage-nav" aria-label="Release growth workflow">{STAGES.map(([key,label],index) => <Link className={activeStage===key?"active":""} href={`/studio/releases/${release.id}?stage=${key}`} key={key}><small>0{index+1}</small><span>{label}</span></Link>)}</nav>

    {activeStage === "overview" ? <div className="v2-release-layout">
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Select</span><h2>{needsYou.length ? `${needsYou.length} thing${needsYou.length===1?"":"s"} blocking the release` : "This release is ready to move"}</h2></div><span className={`v2-count ${needsYou.length?"has-items":""}`}>{needsYou.length}</span></div>
        {needsYou.length ? <div className="v2-inbox">{needsYou.map((item) => <Link className="v2-inbox-item" href={item.href} key={`${item.title}-${item.href}`}><div><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div> : <div className="v2-calm-state compact"><strong>Atlas has what it needs.</strong><p>The track, release identity and operating context are coherent enough to continue.</p></div>}
      </section>
      <aside className="v2-release-summary-card"><div className="v2-release-artwork">{release.artwork_url ? <img src={release.artwork_url} alt={release.cover_alt || `${release.title} artwork`} /> : <div aria-hidden>{release.title.slice(0,1).toUpperCase()}</div>}</div><dl><div><dt>Tracks</dt><dd>{tracks.length}</dd></div><div><dt>Assets</dt><dd>{releaseAssets.length}</dd></div><div><dt>Content</dt><dd>{contentItems.length}</dd></div><div><dt>Health</dt><dd>{score}%</dd></div></dl></aside>
      <ReleaseMasterAudioPanel releaseId={release.id} primaryTrack={primaryTrack} vaultTrack={vaultTrack} />
      {!release.artwork_url && !release.cover_asset ? <section className="v2-section v2-full-column" id="cover-upload"><div className="v2-section-heading"><div><span className="section-label">Identity</span><h2>Drop the cover artwork here</h2></div></div><MediaUploader releaseId={release.id} defaultRole="cover" /></section> : null}
      <section className="v2-section v2-full-column" id="release-details"><div className="v2-section-heading"><div><span className="section-label">Source of truth</span><h2>Only the release facts Atlas must anchor around</h2></div></div><ReleaseForm release={release} releaseDateLocked={releaseDateLocked} /></section>
    </div> : null}

    {activeStage === "plan" ? <div className="release-prepare-grid">
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Prepare</span><h2>One growth plan, anchored to release day</h2></div></div>
        {campaign ? <div className="v2-plan-card"><div><span>{campaign.status}</span><h3>{campaign.name}</h3><p>Objective: {campaign.objective} · Primary signal: {campaign.primary_kpi}</p></div><Link className="button" href={`/studio/campaigns/${campaign.id}`}>Advanced campaign brain</Link></div> : <div className="v2-calm-state compact"><strong>No campaign brain yet.</strong><p>Create one objective-led system so Atlas can connect content, experiments, publishing and learnings around one objective.</p><Link className="button primary" href="/studio/campaigns">Create growth plan</Link></div>}
        <div className="v2-plan-timeline">{planned.length ? planned.slice(0,12).map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform} · {item.status}</small></Link>) : <p className="v2-muted-copy">The release playbook handles free internal preparation even before you spend on finished creative.</p>}</div>
      </section>
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Release playbook</span><h2>{openPlaybook.length} open checkpoint{openPlaybook.length === 1 ? "" : "s"}</h2></div><Link href="/studio/calendar">Calendar</Link></div>
        {openPlaybook.length ? <div className="release-playbook-list">{openPlaybook.slice(0,10).map((task) => <div key={task.id}><span>{task.due_at ? shortDate(task.due_at) : "When ready"}</span><strong>{task.title}</strong><small>{task.priority}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>Preparation checklist is clear.</strong><p>Completed playbook steps stay out of your way.</p></div>}
      </section>
    </div> : null}

    {activeStage === "create" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Build hype</span><h2>Scale one coherent creative world, not filler</h2></div></div><p className="v2-muted-copy release-stage-intro">Use the strongest hook and campaign hypothesis first. Paid generation stays approval-gated; Atlas should derive from winners rather than manufacture unrelated posts.</p><div className="v2-create-grid">
      <Link className="v2-create-card" href="/studio/music"><span className="section-label">Audio</span><h2>Music Lab</h2><p>Develop edits or audio ideas only when the release strategy actually needs them.</p><strong>Open Music Lab →</strong></Link>
      <Link className="v2-create-card" href={`/studio/video?release=${release.id}`}><span className="section-label">Motion</span><h2>Video Director</h2><p>Produce a coherent music-video world with cost checkpoints before paid generation.</p><strong>Open Video Director →</strong></Link>
      <Link className="v2-create-card" href={`/studio/production?release=${release.id}`}><span className="section-label">Campaign creative</span><h2>Production queue</h2><p>Generate, refine and approve only the assets attached to measurable campaign moments.</p><strong>Open production →</strong></Link>
    </div></section> : null}

    {activeStage === "publish" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Release</span><h2>Ship the music and the winning discovery system together</h2></div><Link href="/studio/inbox">Needs you</Link></div><div className="v2-publish-grid">
      <article><span>Website</span><strong>{release.publish_state === "live" ? "Live" : "Not live"}</strong><small>Public catalog state</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=website`}>Website controls →</Link></article>
      <article><span>Listening links</span><strong>{[release.spotify_url,release.soundcloud_url,release.youtube_url].filter(Boolean).length}/3</strong><small>Spotify, SoundCloud, YouTube</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=music`}>Destinations →</Link></article>
      <article><span>Campaign distribution</span><strong>{planned.length}</strong><small>{releaseDateLocked ? `${providerScheduledCount} scheduled at provider` : missingAsset.length ? `${missingAsset.length} still need assets` : `${scheduled.length} ready/scheduled`}</small><Link href={`/studio/production?release=${release.id}`}>Production →</Link></article>
    </div><div className="growth-action-note release-day-note"><strong>Release-day principle</strong><span>Do not increase volume just because the track is live. Watch which discovery angle creates profile visits, music intent, saves and follows, then scale that evidence.</span></div></section> : null}

    {activeStage === "learn" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Sustain</span><h2>Keep the release alive while the signal is useful</h2></div><Link href="/studio/growth#opportunities">Catalog opportunities</Link></div><div className="v2-status-grid">
      <article><strong>{total(metrics,"streams").toLocaleString()}</strong><span>streams</span><small>Recorded snapshots</small></article><article><strong>{total(metrics,"listeners").toLocaleString()}</strong><span>listeners</span><small>Unique audience signal</small></article><article><strong>{total(metrics,"saves").toLocaleString()}</strong><span>saves</span><small>Retention intent</small></article><article><strong>{total(metrics,"playlist_adds").toLocaleString()}</strong><span>playlist adds</span><small>Durable catalog intent</small></article>
    </div><div className="v2-calm-state compact"><strong>Launch week is not the finish line.</strong><p>Growth OS watches for catalog revival and breakout creative signals. Only approved learnings become memory for the next release.</p><div className="actions"><Link className="button primary" href="/studio/growth#opportunities">Scan portfolio opportunities</Link><Link className="button" href="/studio/learn">Learning memory</Link></div></div></section> : null}
  </div>;
}
