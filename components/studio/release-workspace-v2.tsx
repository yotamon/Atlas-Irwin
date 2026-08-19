import Link from "next/link";
import { MediaUploader } from "@/components/studio/media-uploader";
import { ReleaseForm } from "@/components/studio/release-form";
import type { ContentItem, MediaAsset, MediaLink, MetricSnapshot, Release, Track } from "@/types/database";

const STAGES = [["overview","Overview"],["plan","Plan"],["create","Create"],["publish","Publish"],["learn","Learn"]] as const;
type Stage = (typeof STAGES)[number][0];
type CampaignSummary = { id:string; name:string; status:string; mode:string; objective:string; primary_kpi:string } | null;

function shortDate(value: string | null | undefined) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", { month:"short", day:"numeric", year:"numeric", timeZone:"Europe/Berlin" }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value));
}
function total(rows: MetricSnapshot[], key: keyof MetricSnapshot) {
  return rows.reduce((sum,row) => sum + (typeof row[key] === "number" ? Number(row[key]) : 0), 0);
}

export function ReleaseWorkspaceV2({ release, tracks, mediaLinks, mediaAssets, contentItems, metrics, campaign, stage, providerScheduledCount = 0 }: {
  release: Release; tracks: Track[]; mediaLinks: MediaLink[]; mediaAssets: MediaAsset[]; contentItems: ContentItem[]; metrics: MetricSnapshot[]; campaign: CampaignSummary; stage: string; providerScheduledCount?: number;
}) {
  const activeStage: Stage = STAGES.some(([key]) => key === stage) ? stage as Stage : "overview";
  const releaseMediaIds = new Set(mediaLinks.map((link) => link.media_asset_id));
  const releaseAssets = mediaAssets.filter((asset) => releaseMediaIds.has(asset.id));
  const planned = contentItems.filter((item) => item.scheduled_at).sort((a,b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const scheduled = contentItems.filter((item) => item.status === "Scheduled");
  const published = contentItems.filter((item) => item.status === "Published");
  const missingAsset = contentItems.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
  const primaryTrack = tracks.find((track) => track.is_primary) ?? tracks[0] ?? null;
  const releaseDateLocked = providerScheduledCount > 0;
  const needsYou = [
    ...(!release.release_date ? [{ title:"Choose a release date", detail:"Atlas needs one anchor date to move the whole plan.", href:"#release-details" }] : []),
    ...(releaseDateLocked ? [{ title:"External schedule is active", detail:`${providerScheduledCount} post${providerScheduledCount === 1 ? " is" : "s are"} already scheduled at a provider, so the release date is locked against drift.`, href:"?stage=publish" }] : []),
    ...(!primaryTrack ? [{ title:"Add the master track", detail:"The release has no canonical audio yet.", href:"?view=advanced&tab=music" }] : []),
    ...(!release.artwork_url && !release.cover_asset ? [{ title:"Choose cover artwork", detail:"Upload it here and Atlas will attach it as the release cover automatically.", href:"#cover-upload" }] : []),
    ...(!campaign ? [{ title:"Create the release plan", detail:"This older release predates Studio V2 automation.", href:"/studio/campaigns" }] : []),
    ...missingAsset.slice(0,2).map((item) => ({ title:`Finish ${item.title}`, detail:`${item.platform} has a planned date but still needs the creative asset.`, href:`/studio/production?edit=${item.id}` })),
  ];

  return <div className="studio-v2-page release-workspace-v2">
    <header className="v2-release-header">
      <div><Link className="v2-back-link" href="/studio/releases">← Releases</Link><div className="v2-release-title-row"><h1>{release.title}</h1><span>{release.status}</span></div><p>{release.release_type} · {shortDate(release.release_date)}</p></div>
      <div className="actions"><Link className="button" href={`/studio/releases/${release.id}?view=advanced`}>Advanced view</Link></div>
    </header>
    <nav className="v2-stage-nav" aria-label="Release workflow">{STAGES.map(([key,label],index) => <Link className={activeStage===key?"active":""} href={`/studio/releases/${release.id}?stage=${key}`} key={key}><small>0{index+1}</small><span>{label}</span></Link>)}</nav>

    {activeStage === "overview" ? <div className="v2-release-layout">
      <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Needs you</span><h2>{needsYou.length ? `${needsYou.length} thing${needsYou.length===1?"":"s"} blocking progress` : "Nothing is blocked"}</h2></div><span className={`v2-count ${needsYou.length?"has-items":""}`}>{needsYou.length}</span></div>
        {needsYou.length ? <div className="v2-inbox">{needsYou.map((item) => <Link className="v2-inbox-item" href={item.href} key={`${item.title}-${item.href}`}><div><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div> : <div className="v2-calm-state compact"><strong>Atlas has what it needs.</strong><p>Routine planning can keep moving without another manual status update.</p></div>}
      </section>
      <aside className="v2-release-summary-card"><div className="v2-release-artwork">{release.artwork_url ? <img src={release.artwork_url} alt={release.cover_alt || `${release.title} artwork`} /> : <div aria-hidden>{release.title.slice(0,1).toUpperCase()}</div>}</div><dl><div><dt>Tracks</dt><dd>{tracks.length}</dd></div><div><dt>Assets</dt><dd>{releaseAssets.length}</dd></div><div><dt>Content</dt><dd>{contentItems.length}</dd></div><div><dt>Published</dt><dd>{published.length}</dd></div></dl></aside>
      {!release.artwork_url && !release.cover_asset ? <section className="v2-section v2-full-column" id="cover-upload"><div className="v2-section-heading"><div><span className="section-label">Cover</span><h2>Drop the artwork here</h2></div></div><MediaUploader releaseId={release.id} defaultRole="cover" /></section> : null}
      <section className="v2-section v2-full-column" id="release-details"><div className="v2-section-heading"><div><span className="section-label">Release details</span><h2>Keep the source of truth simple</h2></div></div><ReleaseForm release={release} releaseDateLocked={releaseDateLocked} /></section>
    </div> : null}

    {activeStage === "plan" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Plan</span><h2>One timeline anchored to the release date</h2></div></div>
      {campaign ? <div className="v2-plan-card"><div><span>{campaign.status}</span><h3>{campaign.name}</h3><p>Objective: {campaign.objective} · Primary signal: {campaign.primary_kpi}</p></div><Link className="button" href={`/studio/campaigns/${campaign.id}`}>AI / advanced plan</Link></div> : <div className="v2-calm-state compact"><strong>This legacy release has no V2 plan yet.</strong><p>Create one campaign and Atlas will anchor the timeline to the release date.</p><Link className="button primary" href="/studio/campaigns">Create plan</Link></div>}
      <div className="v2-plan-timeline">{planned.length ? planned.slice(0,12).map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform} · {item.status}</small></Link>) : <p className="v2-muted-copy">New V2 releases receive a free starter timeline automatically. AI strategy generation is optional and cost-gated.</p>}</div>
    </section> : null}

    {activeStage === "create" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Create</span><h2>Make only what this release needs</h2></div></div><div className="v2-create-grid">
      <Link className="v2-create-card" href="/studio/music"><span className="section-label">Audio</span><h2>Music Lab</h2><p>Generate or develop track ideas with explicit cost approval before paid calls.</p><strong>Open Music Lab →</strong></Link>
      <Link className="v2-create-card" href={`/studio/releases/${release.id}?view=advanced&tab=video`}><span className="section-label">Motion</span><h2>Video Director</h2><p>Plan and produce the music video in release context, with cost checkpoints before Higgsfield calls.</p><strong>Open Video Director →</strong></Link>
      <Link className="v2-create-card" href={`/studio/production?release=${release.id}`}><span className="section-label">Social</span><h2>Production queue</h2><p>Refine starter moments and campaign drafts that actually need human creative input.</p><strong>Open production →</strong></Link>
    </div></section> : null}

    {activeStage === "publish" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Publish</span><h2>Approve outcomes, not database fields</h2></div><Link href="/studio/inbox">Needs you</Link></div><div className="v2-publish-grid">
      <article><span>Website</span><strong>{release.publish_state === "live" ? "Live" : "Not live"}</strong><small>Public catalog state</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=website`}>Website controls →</Link></article>
      <article><span>Listening links</span><strong>{[release.spotify_url,release.soundcloud_url,release.youtube_url].filter(Boolean).length}/3</strong><small>Spotify, SoundCloud, YouTube</small><Link href={`/studio/releases/${release.id}?view=advanced&tab=music`}>Destinations →</Link></article>
      <article><span>Planned content</span><strong>{planned.length}</strong><small>{releaseDateLocked ? `${providerScheduledCount} scheduled at provider` : missingAsset.length ? `${missingAsset.length} still need assets` : `${scheduled.length} ready/scheduled`}</small><Link href={`/studio/production?release=${release.id}`}>Production →</Link></article>
    </div></section> : null}

    {activeStage === "learn" ? <section className="v2-section"><div className="v2-section-heading"><div><span className="section-label">Learn</span><h2>What this release is teaching Atlas</h2></div><Link href="/studio/learn">Learning memory</Link></div><div className="v2-status-grid">
      <article><strong>{total(metrics,"streams").toLocaleString()}</strong><span>streams</span><small>Recorded snapshots</small></article><article><strong>{total(metrics,"views").toLocaleString()}</strong><span>content views</span><small>Recorded snapshots</small></article><article><strong>{total(metrics,"saves").toLocaleString()}</strong><span>saves</span><small>Recorded snapshots</small></article><article><strong>{published.length}</strong><span>published items</span><small>Release content</small></article>
    </div><div className="v2-calm-state compact"><strong>Performance changes the next plan.</strong><p>Only approved learnings are reused, so Atlas gets smarter without silently rewriting your taste.</p></div></section> : null}
  </div>;
}
