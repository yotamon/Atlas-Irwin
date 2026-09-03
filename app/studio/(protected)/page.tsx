import Link from "next/link";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { createAutonomyServiceClient } from "@/lib/marketing/autonomy-db";
import { asMarketingClient } from "@/lib/marketing/db";
import { lifecycleLabel, releaseLifecycle } from "@/lib/marketing/release-lifecycle";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { asArtistScopedOperationalClient } from "@/lib/studio/operational-db";
import { asSocialClient } from "@/lib/studio/social-db";
import { buildGrowthFunnel, diagnoseGrowthFunnel, rankVaultTracks } from "@/lib/studio/growth";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Europe/Berlin" }).format(
    new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value),
  );
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

function isStale(value: string | null | undefined, days: number) {
  if (!value) return true;
  return Date.now() - new Date(value).getTime() > days * 86_400_000;
}

export default async function TodayPage() {
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const operational = asArtistScopedOperationalClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const marketing = asMarketingClient(supabase);
  const growth = asGrowthClient(supabase);
  const social = asSocialClient(supabase);
  const autonomy = createAutonomyServiceClient();
  const now = new Date();
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);

  const [
    releasesResult,
    tasksResult,
    campaignsResult,
    automationResult,
    publicationResult,
    contentResult,
    learningsResult,
    opportunityResult,
    vaultResult,
    metricsResult,
    nextActionsResult,
    spotifyAccountResult,
    soundCloudAccountResult,
    socialResult,
    soundCloudPendingResult,
    spotifyPendingResult,
    outreachDraftsResult,
  ] = await Promise.all([
    music.from("releases").select("id,title,release_date,artwork_url,cover_alt,status,active_release").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    operational.from("tasks").select("id,title,due_at,priority,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("Done","Skipped")').order("due_at", { ascending: true }).limit(30),
    marketing.from("campaigns").select("id,release_id,name,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["draft", "planned", "active"]),
    marketing.from("automation_jobs").select("id,campaign_id,job_type,status,approval_status,run_after").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("completed","failed","cancelled")').order("run_after", { ascending: true }).limit(40),
    marketing.from("publication_jobs").select("id,campaign_id,content_item_id,platform,status,approval_status,scheduled_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "in", '("published","failed","cancelled")').order("scheduled_at", { ascending: true }).limit(40),
    marketing.from("content_items").select("id,release_id,campaign_id,title,platform,status,asset_url,scheduled_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("status", "eq", "Archived").order("scheduled_at", { ascending: true }).limit(100),
    marketing.from("marketing_learnings").select("id,finding,status,confidence,created_at").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["proposed", "approved"]).order("created_at", { ascending: false }).limit(20),
    growth.from("growth_opportunities").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["new", "accepted"]).order("priority", { ascending: false }).limit(12),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).neq("status", "archived"),
    marketing.from("metric_snapshots").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    autonomy.from("next_best_actions").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("status", "proposed").order("score", { ascending: false }).limit(8),
    supabase.from("spotify_accounts").select("last_synced_at").eq("owner_id", user.id).maybeSingle(),
    supabase.from("soundcloud_accounts").select("last_synced_at").eq("owner_id", user.id).maybeSingle(),
    social.from("social_channel_accounts").select("platform,status,can_publish").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    supabase.from("soundcloud_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    marketing.from("outreach_messages").select("id").eq("owner_id", user.id).eq("artist_id", artist.artistId).is("sent_at", null).eq("response_status", "Draft"),
  ]);

  const firstError = [
    releasesResult, tasksResult, campaignsResult, automationResult, publicationResult, contentResult,
    learningsResult, opportunityResult, vaultResult, metricsResult, nextActionsResult, spotifyAccountResult,
    soundCloudAccountResult, socialResult, soundCloudPendingResult, spotifyPendingResult, outreachDraftsResult,
  ].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const content = contentResult.data ?? [];
  const automation = automationResult.data ?? [];
  const publications = publicationResult.data ?? [];
  const learnings = learningsResult.data ?? [];
  const opportunities = opportunityResult.data ?? [];
  const metrics = metricsResult.data ?? [];
  const nextActions = nextActionsResult.data ?? [];
  const activeRelease = releases.find((release) => release.active_release)
    ?? releases.find((release) => release.release_date && release.release_date >= now.toISOString().slice(0, 10))
    ?? releases[0]
    ?? null;
  const activeLifecycle = activeRelease
    ? releaseLifecycle({ releaseDate: activeRelease.release_date, status: activeRelease.status }, now)
    : null;

  const funnel = buildGrowthFunnel(metrics);
  const diagnosis = diagnoseGrowthFunnel(funnel);
  const topVaultCandidate = rankVaultTracks(vaultResult.data ?? []).find((item) => item.eligible && !item.track.linked_release_id) ?? null;
  const biggestRisk = opportunities.find((item) => item.kind === "release_risk" && item.status === "new") ?? null;
  const biggestOpportunity = opportunities.find((item) => item.kind !== "release_risk" && item.status === "new") ?? null;
  const nextAction = nextActions[0] ?? null;

  const workflowApprovalCount = automation.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length
    + publications.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length;
  const manualReady = publications.filter((job) => String(job.status) === "manual_ready");
  const providerScheduled = publications.filter((job) => String(job.status) === "provider_scheduled");
  const unmatched = [...(soundCloudPendingResult.data ?? []), ...(spotifyPendingResult.data ?? [])].filter((item) => !item.linked_track_id).length;
  const missingAssets = content.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
  const proposedLearnings = learnings.filter((learning) => learning.status === "proposed");
  const approvedLearnings = learnings.filter((learning) => learning.status === "approved");
  const dueTasks = (tasksResult.data ?? []).filter((task) => task.due_at && new Date(task.due_at) <= sevenDays);
  const outreachDraftCount = outreachDraftsResult.data?.length ?? 0;

  const connectedSocial = (socialResult.data ?? []).filter((account) => account.status === "connected");
  const publishableSocial = connectedSocial.filter((account) => account.can_publish);
  const soundCloudStale = isStale(soundCloudAccountResult.data?.last_synced_at, 7);
  const spotifyConnected = Boolean(spotifyAccountResult.data);
  const hasContentPerformance = metrics.some((row) => Boolean(row.content_item_id) && (row.views > 0 || row.reach > 0));
  const evidenceItems = [
    { label: "Social execution", value: connectedSocial.length ? `${connectedSocial.length} connected` : "Missing", kind: connectedSocial.length ? "Measured" : "Low evidence", detail: publishableSocial.length ? `${publishableSocial.length} can publish` : "No connected publishing permission" },
    { label: "Spotify data", value: spotifyConnected ? "Connected" : "Missing", kind: spotifyConnected ? "Measured" : "Low evidence", detail: spotifyConnected ? (isStale(spotifyAccountResult.data?.last_synced_at, 7) ? "Sync is stale" : "Recent sync available") : "Growth conclusions exclude Spotify account data" },
    { label: "SoundCloud data", value: soundCloudAccountResult.data ? (soundCloudStale ? "Stale" : "Connected") : "Missing", kind: soundCloudAccountResult.data ? "Measured" : "Low evidence", detail: soundCloudAccountResult.data?.last_synced_at ? `Last sync ${shortDate(soundCloudAccountResult.data.last_synced_at)}` : "No account sync" },
    { label: "Creative learning", value: hasContentPerformance ? "Learning" : "Low evidence", kind: hasContentPerformance ? "Artist learned" : "Working benchmark", detail: hasContentPerformance ? "Content-level performance can train future decisions" : "Current funnel targets are working heuristics, not artist-specific truth yet" },
  ];

  const needsYou = [
    ...(workflowApprovalCount ? [{ id: "approvals", eyebrow: "Approval", title: `${workflowApprovalCount} workflow approval${workflowApprovalCount === 1 ? "" : "s"} ready`, detail: "External effects remain explicitly yours to authorize.", href: "/studio/inbox", tone: "important" }] : []),
    ...(outreachDraftCount ? [{ id: "outreach", eyebrow: "Outreach", title: `${outreachDraftCount} message${outreachDraftCount === 1 ? "" : "s"} prepared`, detail: "Approve delivery or receive a manual handoff.", href: "/studio/inbox", tone: "important" }] : []),
    ...manualReady.slice(0, 1).map((job) => ({ id: `manual-${job.id}`, eyebrow: "Manual handoff", title: `${job.platform} is prepared`, detail: "Ensemblis prepared the exact handoff instead of pretending it published.", href: job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/inbox", tone: "warning" })),
    ...(unmatched ? [{ id: "unmatched", eyebrow: "Ambiguous data", title: `${unmatched} catalog match${unmatched === 1 ? "" : "es"} need a decision`, detail: "Only ambiguous reconciliation reaches you.", href: "/studio/data-health?category=unmatched", tone: "warning" }] : []),
    ...missingAssets.slice(0, 2).map((item) => ({ id: `asset-${item.id}`, eyebrow: "Creative", title: `${item.title} is waiting for its asset`, detail: `${item.platform}${item.scheduled_at ? ` · ${shortDate(item.scheduled_at)}` : ""}`, href: `/studio/production?edit=${item.id}`, tone: "normal" })),
    ...dueTasks.slice(0, 2).map((task) => ({ id: `task-${task.id}`, eyebrow: "Task", title: task.title, detail: task.due_at ? `${task.priority} · ${dateDistance(task.due_at)}` : task.priority, href: activeRelease ? `/studio/releases/${activeRelease.id}` : "/studio/releases", tone: "normal" })),
    ...(proposedLearnings.length ? [{ id: "learnings", eyebrow: "Learning", title: `${proposedLearnings.length} evidence-backed insight${proposedLearnings.length === 1 ? "" : "s"} to review`, detail: `Only approved findings become future memory for ${artist.artistName}.`, href: "/studio/learn", tone: "normal" }] : []),
  ].slice(0, 8);

  const workingJobs = automation.filter((job) => job.status === "queued" || job.status === "running");
  const scheduledPublications = publications.filter((job) => ["approved", "scheduled", "publishing", "provider_scheduled"].includes(String(job.status)));
  const upcomingContent = content.filter((item) => item.scheduled_at && new Date(item.scheduled_at) >= now && new Date(item.scheduled_at) <= sevenDays);

  return (
    <div className="studio-v2-page">
      <PageHeader title="Today" description={`One command center for ${artist.artistName}. Ensemblis handles safe internal work and interrupts you only for judgment, money, ambiguity or external effects.`} action={<Link className="button primary" href="/studio/inbox">Needs you{workflowApprovalCount ? ` (${workflowApprovalCount})` : ""}</Link>} />

      <section className="v2-section today-growth-diagnosis">
        <div className="v2-section-heading"><div><span className="section-label">Next best action</span><h2>{nextAction?.title || "Ensemblis can keep moving without interrupting you"}</h2></div>{nextAction ? <Status>{Math.round(Number(nextAction.score))}/100 ranked signal</Status> : <Status>clear</Status>}</div>
        {nextAction ? <><p className="v2-muted-copy">{nextAction.rationale}</p><div className="actions"><Link className="button primary" href={actionHref(nextAction)}>Act on this</Link><Link className="button" href="/studio/growth">Inspect evidence</Link></div></> : <div className="v2-calm-state compact"><strong>No higher-leverage human intervention is currently ranked.</strong><p>The marketing heartbeat will keep reconciling lifecycle, preparing production and surfacing approvals automatically.</p></div>}
      </section>

      <section className="v2-hero-grid">
        <article className="v2-focus-card">
          <div className="v2-section-heading"><div><span className="section-label">Needs you</span><h2>{needsYou.length ? `${needsYou.length} thing${needsYou.length === 1 ? "" : "s"}` : "You are clear"}</h2></div><Link href="/studio/inbox">Approval inbox</Link></div>
          {needsYou.length ? <div className="v2-inbox">{needsYou.map((item) => <Link className={`v2-inbox-item ${item.tone}`} href={item.href} key={item.id}><div><span>{item.eyebrow}</span><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div> : <div className="v2-calm-state"><strong>Nothing is blocked on you.</strong><p>Ensemblis can keep moving with the context and approvals it already has.</p></div>}
        </article>
        <article className="v2-release-card">
          <span className="section-label">Current music</span>
          {activeRelease ? <><div className="v2-release-artwork">{activeRelease.artwork_url ? <img src={activeRelease.artwork_url} alt={activeRelease.cover_alt || `${activeRelease.title} artwork`} /> : <div aria-hidden>{activeRelease.title.slice(0, 1).toUpperCase()}</div>}</div><h2>{activeRelease.title}</h2><p>{activeLifecycle ? lifecycleLabel(activeLifecycle) : activeRelease.status}{activeRelease.release_date ? ` · ${shortDate(activeRelease.release_date)}` : ""}</p><div className="v2-release-actions"><Link className="button primary" href={`/studio/releases/${activeRelease.id}`}>Open release</Link><Link className="button" href="/studio/growth#queue">Portfolio</Link></div></> : <div className="v2-calm-state"><strong>No release in motion</strong><p>Choose from the Vault instead of creating a release blindly.</p><Link className="button primary" href="/studio/growth#vault">Choose next track</Link></div>}
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Evidence readiness</span><h2>Know what Ensemblis actually knows</h2></div><Link href="/studio/settings">Connections</Link></div>
        <p className="v2-muted-copy">Measured data, derived calculations and working benchmarks are intentionally separated. A precise-looking score is never presented as learned truth when the evidence is thin.</p>
        <div className="v2-status-grid">{evidenceItems.map((item) => <article key={item.label}><strong>{item.value}</strong><span>{item.label}</span><small>{item.kind} · {item.detail}</small></article>)}</div>
      </section>

      <section className="growth-command-grid today-growth-pulse">
        <article className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Portfolio risk</span><h2>{biggestRisk ? biggestRisk.title : "No evidence-backed release risk"}</h2></div></div>
          {biggestRisk ? <><p className="v2-muted-copy">{biggestRisk.rationale}</p><Link className="button" href="/studio/growth#opportunities">Review evidence</Link></> : <div className="v2-calm-state compact"><strong>No red alert.</strong><p>Ensemblis prefers silence over manufacturing urgency.</p></div>}
        </article>
        <article className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Portfolio opportunity</span><h2>{biggestOpportunity ? biggestOpportunity.title : topVaultCandidate ? `${topVaultCandidate.track.title} is the strongest current candidate` : "Waiting for stronger signal"}</h2></div></div>
          {biggestOpportunity ? <><p className="v2-muted-copy">{biggestOpportunity.rationale}</p><Link className="button primary" href="/studio/growth#opportunities">Review opportunity</Link></> : topVaultCandidate ? <><p className="v2-muted-copy">Working portfolio score {Math.round(topVaultCandidate.score)}/100 · {topVaultCandidate.reasons.join(" · ")}. This is a deterministic heuristic until Ensemblis has enough artist-specific release outcomes.</p><Link className="button primary" href="/studio/growth#vault">Review candidate</Link></> : <div className="v2-calm-state compact"><strong>Add the unreleased backlog.</strong><p>The portfolio manager becomes useful when it can see the music waiting behind the current release.</p></div>}
        </article>
      </section>

      {diagnosis ? <section className="v2-section today-growth-diagnosis"><div className="v2-section-heading"><div><span className="section-label">Working benchmark · funnel</span><h2>{diagnosis.label}</h2></div><Link href="/studio/growth#funnel">Full funnel</Link></div><p className="v2-muted-copy">{diagnosis.diagnosis}</p><div className="growth-action-note"><strong>Recommended move</strong><span>{diagnosis.action}</span></div><small className="v2-muted-copy">The comparison target is a working Ensemblis benchmark, not an artist-learned threshold yet.</small></section> : null}

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Ensemblis is working on</span><h2>Automation, not admin</h2></div><Link href="/studio/settings">Automation settings</Link></div>
        <div className="v2-status-grid">
          <article><strong>{workingJobs.length}</strong><span>automation jobs</span><small>Queued or running</small></article>
          <article><strong>{scheduledPublications.length}</strong><span>publication jobs</span><small>{providerScheduled.length ? `${providerScheduled.length} scheduled at providers` : "Approved, scheduled or publishing"}</small></article>
          <article><strong>{upcomingContent.length}</strong><span>content moments</span><small>Next 7 days</small></article>
          <article><strong>{funnel.fanSignalScore.toLocaleString()}</strong><span>active fan proxy</span><small>Derived signal, not a platform metric</small></article>
        </div>
      </section>

      <section className="v2-two-column">
        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Next 7 days</span><h2>What Ensemblis is preparing</h2></div><Link href="/studio/calendar">Full timeline</Link></div>
          {upcomingContent.length ? <div className="v2-simple-list">{upcomingContent.slice(0, 6).map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform} · {item.asset_url ? "asset ready" : "creative pending"}</small></Link>)}</div> : <div className="v2-calm-state compact"><strong>No scheduled content this week.</strong><p>The lifecycle-aware campaign engine will populate only future connected-channel work when it is useful.</p></div>}
        </article>
        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Artist-learned memory</span><h2>What worked</h2></div><Link href="/studio/learn">Learning memory</Link></div>
          {approvedLearnings.length ? <div className="v2-learning-list">{approvedLearnings.slice(0, 4).map((learning) => <div key={learning.id}><strong>{Math.round(Number(learning.confidence) * 100)}%</strong><p>{learning.finding}</p></div>)}</div> : <div className="v2-calm-state compact"><strong>No approved learnings yet.</strong><p>Ensemblis will not pretend working benchmarks are artist-specific learning. This fills only after real campaigns produce attributable evidence.</p></div>}
        </article>
      </section>
    </div>
  );
}
