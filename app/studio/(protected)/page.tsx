import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { asGrowthClient } from "@/lib/studio/growth-db";
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

export default async function TodayPage() {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const growth = asGrowthClient(supabase);
  const now = new Date();
  const sevenDays = new Date(now);
  sevenDays.setDate(sevenDays.getDate() + 7);

  const [
    releasesResult,
    tasksResult,
    soundCloudResult,
    spotifyResult,
    campaignsResult,
    automationResult,
    publicationResult,
    contentResult,
    learningsResult,
    followupsResult,
    outreachDraftsResult,
    opportunityResult,
    vaultResult,
    metricsResult,
  ] = await Promise.all([
    supabase.from("releases").select("id,title,release_date,artwork_url,cover_alt,status,active_release").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    supabase.from("tasks").select("id,title,due_at,priority,status").eq("owner_id", user.id).neq("status", "Done").order("due_at", { ascending: true }).limit(20),
    supabase.from("soundcloud_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    supabase.from("spotify_tracks").select("id,linked_track_id").eq("owner_id", user.id).eq("reconcile_status", "pending"),
    marketing.from("campaigns").select("id,release_id,name,status").eq("owner_id", user.id).in("status", ["draft", "planned", "active"]),
    marketing.from("automation_jobs").select("id,campaign_id,job_type,status,approval_status,run_after").eq("owner_id", user.id).not("status", "in", '("completed","failed","cancelled")').order("run_after", { ascending: true }).limit(40),
    marketing.from("publication_jobs").select("id,campaign_id,content_item_id,platform,status,approval_status,scheduled_at").eq("owner_id", user.id).not("status", "in", '("published","failed","cancelled")').order("scheduled_at", { ascending: true }).limit(40),
    marketing.from("content_items").select("id,release_id,campaign_id,title,platform,status,asset_url,scheduled_at").eq("owner_id", user.id).not("status", "eq", "Archived").order("scheduled_at", { ascending: true }).limit(100),
    marketing.from("marketing_learnings").select("id,finding,status,confidence,created_at").eq("owner_id", user.id).in("status", ["proposed", "approved"]).order("created_at", { ascending: false }).limit(20),
    supabase.from("outreach_messages").select("id,contact_id,channel,follow_up_at").eq("owner_id", user.id).not("follow_up_at", "is", null).lte("follow_up_at", sevenDays.toISOString()).order("follow_up_at", { ascending: true }).limit(12),
    marketing.from("outreach_messages").select("id").eq("owner_id", user.id).is("sent_at", null).eq("response_status", "Draft"),
    growth.from("growth_opportunities").select("*").eq("owner_id", user.id).in("status", ["new","accepted"]).order("priority", { ascending: false }).limit(12),
    growth.from("track_vault").select("*").eq("owner_id", user.id).neq("status", "archived"),
    supabase.from("metric_snapshots").select("*").eq("owner_id", user.id),
  ]);

  const firstError = [releasesResult,tasksResult,soundCloudResult,spotifyResult,campaignsResult,automationResult,publicationResult,contentResult,learningsResult,followupsResult,outreachDraftsResult,opportunityResult,vaultResult,metricsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const followups = followupsResult.data ?? [];
  const contactIds = [...new Set(followups.map((message) => message.contact_id))];
  const { data: contacts, error: contactError } = contactIds.length
    ? await supabase.from("outreach_contacts").select("id,name").eq("owner_id", user.id).in("id", contactIds)
    : { data: [], error: null };
  if (contactError) throw new Error(contactError.message);
  const contactById = new Map((contacts ?? []).map((contact) => [contact.id, contact.name]));

  const releases = releasesResult.data ?? [];
  const content = contentResult.data ?? [];
  const automation = automationResult.data ?? [];
  const publications = publicationResult.data ?? [];
  const learnings = learningsResult.data ?? [];
  const opportunities = opportunityResult.data ?? [];
  const outreachDraftCount = outreachDraftsResult.data?.length ?? 0;
  const activeRelease = releases.find((release) => release.active_release) ?? releases.find((release) => release.release_date && release.release_date >= now.toISOString().slice(0, 10)) ?? releases[0] ?? null;

  const funnel = buildGrowthFunnel(metricsResult.data ?? []);
  const diagnosis = diagnoseGrowthFunnel(funnel);
  const topVaultCandidate = rankVaultTracks(vaultResult.data ?? []).find((item) => item.eligible && !item.track.linked_release_id) ?? null;
  const biggestRisk = opportunities.find((item) => item.kind === "release_risk" && item.status === "new") ?? null;
  const biggestOpportunity = opportunities.find((item) => item.kind !== "release_risk" && item.status === "new") ?? null;

  const workflowApprovalCount = automation.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length + publications.filter((job) => job.status === "awaiting_approval" || job.approval_status === "pending").length;
  const manualReady = publications.filter((job) => String(job.status) === "manual_ready");
  const providerScheduled = publications.filter((job) => String(job.status) === "provider_scheduled");
  const unmatched = [...(soundCloudResult.data ?? []), ...(spotifyResult.data ?? [])].filter((item) => !item.linked_track_id).length;
  const missingAssets = content.filter((item) => item.scheduled_at && !item.asset_url && item.status !== "Published");
  const proposed = learnings.filter((learning) => learning.status === "proposed");
  const approvedLearnings = learnings.filter((learning) => learning.status === "approved");
  const dueTasks = (tasksResult.data ?? []).filter((task) => task.due_at && new Date(task.due_at) <= sevenDays);

  const needsYou = [
    ...(workflowApprovalCount ? [{ id: "approvals", eyebrow: "Approval", title: `${workflowApprovalCount} workflow approval${workflowApprovalCount === 1 ? "" : "s"} ready`, detail: "Review external publication and exceptional automation in one place.", href: "/studio/inbox", tone: "important" }] : []),
    ...(outreachDraftCount ? [{ id: "outreach-drafts", eyebrow: "Outreach approval", title: `${outreachDraftCount} message${outreachDraftCount === 1 ? "" : "s"} prepared`, detail: "Approve connected delivery or receive a prepared manual handoff.", href: "/studio/inbox", tone: "important" }] : []),
    ...manualReady.slice(0, 2).map((job) => ({ id: `manual-${job.id}`, eyebrow: "Manual handoff", title: `${job.platform} is prepared`, detail: "No publishing adapter is connected, so Atlas prepared the approved handoff instead of pretending it published.", href: job.content_item_id ? `/studio/production?edit=${job.content_item_id}` : "/studio/inbox", tone: "warning" })),
    ...(unmatched ? [{ id: "unmatched", eyebrow: "Ambiguous data", title: `${unmatched} catalog match${unmatched === 1 ? "" : "es"} need a decision`, detail: "Safe exact matches are repaired automatically. Only ambiguity reaches you.", href: "/studio/data-health?category=unmatched", tone: "warning" }] : []),
    ...missingAssets.slice(0, 2).map((item) => ({ id: `asset-${item.id}`, eyebrow: "Creative blocker", title: `${item.title} needs an asset`, detail: `${item.platform}${item.scheduled_at ? ` · ${shortDate(item.scheduled_at)}` : ""}`, href: `/studio/production?edit=${item.id}`, tone: "normal" })),
    ...followups.slice(0, 2).map((message) => ({ id: `outreach-${message.id}`, eyebrow: "Follow-up", title: `Follow up with ${contactById.get(message.contact_id) || "contact"}`, detail: `${message.channel} · ${dateDistance(message.follow_up_at)}`, href: `/studio/outreach/${message.contact_id}`, tone: "normal" })),
    ...dueTasks.slice(0, 2).map((task) => ({ id: `task-${task.id}`, eyebrow: "Task", title: task.title, detail: task.due_at ? `${task.priority} · ${dateDistance(task.due_at)}` : task.priority, href: "/studio/calendar", tone: "normal" })),
    ...(proposed.length ? [{ id: "learnings", eyebrow: "Learning", title: `${proposed.length} insight${proposed.length === 1 ? "" : "s"} to review`, detail: "Approve only what Atlas should remember for future releases.", href: "/studio/learn", tone: "normal" }] : []),
  ].slice(0, 8);

  const workingJobs = automation.filter((job) => job.status === "queued" || job.status === "running");
  const scheduledPublications = publications.filter((job) => ["approved", "scheduled", "publishing", "provider_scheduled"].includes(String(job.status)));
  const upcomingContent = content.filter((item) => item.scheduled_at && new Date(item.scheduled_at) >= now && new Date(item.scheduled_at) <= sevenDays);

  return (
    <div className="studio-v2-page">
      <PageHeader title="Today" description="The highest-leverage decisions for growing Atlas Irwin. Routine internal work stays automated." action={<Link className="button primary" href="/studio/growth">Open Growth OS</Link>} />

      <section className="growth-command-grid today-growth-pulse">
        <article className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Biggest risk</span><h2>{biggestRisk ? biggestRisk.title : "No launch risk detected"}</h2></div></div>
          {biggestRisk ? <><p className="v2-muted-copy">{biggestRisk.rationale}</p><Link className="button" href="/studio/growth#opportunities">Resolve in Growth OS</Link></> : <div className="v2-calm-state compact"><strong>Current releases have no evidence-backed red alert.</strong><p>Atlas only escalates a risk when timing or readiness data supports it.</p></div>}
        </article>
        <article className="v2-section">
          <div className="v2-section-heading"><div><span className="section-label">Biggest opportunity</span><h2>{biggestOpportunity ? biggestOpportunity.title : topVaultCandidate ? `${topVaultCandidate.track.title} is your strongest next candidate` : "Waiting for stronger signal"}</h2></div></div>
          {biggestOpportunity ? <><p className="v2-muted-copy">{biggestOpportunity.rationale}</p><Link className="button primary" href="/studio/growth#opportunities">Review opportunity</Link></> : topVaultCandidate ? <><p className="v2-muted-copy">Portfolio score {Math.round(topVaultCandidate.score)}/100 · {topVaultCandidate.reasons.join(" · ")}.</p><Link className="button primary" href="/studio/growth#vault">Review candidate</Link></> : <div className="v2-calm-state compact"><strong>Add the unreleased backlog.</strong><p>The manager becomes useful when it can see the music waiting behind the current release.</p></div>}
        </article>
      </section>

      {diagnosis ? <section className="v2-section today-growth-diagnosis"><div className="v2-section-heading"><div><span className="section-label">What matters most today</span><h2>{diagnosis.label}</h2></div><Link href="/studio/growth#funnel">Full funnel</Link></div><p className="v2-muted-copy">{diagnosis.diagnosis}</p><div className="growth-action-note"><strong>Recommended move</strong><span>{diagnosis.action}</span></div></section> : null}

      <section className="v2-hero-grid">
        <article className="v2-focus-card">
          <div className="v2-section-heading"><div><span className="section-label">Needs you</span><h2>{needsYou.length ? `${needsYou.length} thing${needsYou.length === 1 ? "" : "s"}` : "You are clear"}</h2></div><Link href="/studio/inbox">Review all</Link></div>
          {needsYou.length ? <div className="v2-inbox">{needsYou.map((item) => <Link className={`v2-inbox-item ${item.tone}`} href={item.href} key={item.id}><div><span>{item.eyebrow}</span><strong>{item.title}</strong><small>{item.detail}</small></div><b aria-hidden>→</b></Link>)}</div> : <div className="v2-calm-state"><strong>Nothing is blocked on you.</strong><p>Atlas can keep moving with the context and approvals it already has.</p></div>}
        </article>
        <article className="v2-release-card">
          <span className="section-label">Next release</span>
          {activeRelease ? <><div className="v2-release-artwork">{activeRelease.artwork_url ? <img src={activeRelease.artwork_url} alt={activeRelease.cover_alt || `${activeRelease.title} artwork`} /> : <div aria-hidden>{activeRelease.title.slice(0, 1).toUpperCase()}</div>}</div><h2>{activeRelease.title}</h2><p>{activeRelease.release_date ? `${shortDate(activeRelease.release_date)} · ${dateDistance(activeRelease.release_date)}` : "Release date not set"}</p><div className="v2-release-actions"><Link className="button primary" href={`/studio/releases/${activeRelease.id}`}>Open release</Link><Link className="button" href="/studio/growth#queue">Portfolio queue</Link></div></> : <div className="v2-calm-state"><strong>No release in motion</strong><p>Choose from the Vault instead of creating a release blindly.</p><Link className="button primary" href="/studio/growth#vault">Choose next track</Link></div>}
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading"><div><span className="section-label">Atlas is working on</span><h2>Automation, not admin</h2></div><Link href="/studio/settings">Automation settings</Link></div>
        <div className="v2-status-grid">
          <article><strong>{workingJobs.length}</strong><span>automation jobs</span><small>Queued or running</small></article>
          <article><strong>{scheduledPublications.length}</strong><span>publication jobs</span><small>{providerScheduled.length ? `${providerScheduled.length} scheduled at providers` : "Approved, scheduled or publishing"}</small></article>
          <article><strong>{upcomingContent.length}</strong><span>content moments</span><small>Next 7 days</small></article>
          <article><strong>{funnel.fanSignalScore.toLocaleString()}</strong><span>active fan signal</span><small>Durable audience proxy</small></article>
        </div>
      </section>

      <section className="v2-two-column">
        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">Next 7 days</span><h2>What is coming</h2></div><Link href="/studio/calendar">Full timeline</Link></div>
          {upcomingContent.length ? <div className="v2-simple-list">{upcomingContent.slice(0, 6).map((item) => <Link href={`/studio/production?edit=${item.id}`} key={item.id}><span>{shortDate(item.scheduled_at)}</span><strong>{item.title}</strong><small>{item.platform}</small></Link>)}</div> : <div className="v2-calm-state compact"><strong>No scheduled content this week.</strong><p>The release playbook and campaign planning will populate this when useful.</p></div>}
        </article>
        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading"><div><span className="section-label">What worked</span><h2>Reusable learnings</h2></div><Link href="/studio/learn">Learn</Link></div>
          {approvedLearnings.length ? <div className="v2-learning-list">{approvedLearnings.slice(0, 4).map((learning) => <div key={learning.id}><strong>{Math.round(Number(learning.confidence) * 100)}%</strong><p>{learning.finding}</p></div>)}</div> : <div className="v2-calm-state compact"><strong>No approved learnings yet.</strong><p>Atlas will suggest evidence-backed memory after campaigns collect enough signal.</p></div>}
        </article>
      </section>
    </div>
  );
}
