import Link from "next/link";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(value.length === 10 ? `${value}T12:00:00` : value),
  );
}

function dateDistance(value: string | null | undefined) {
  if (!value) return "Date not set";
  const target = new Date(value.length === 10 ? `${value}T12:00:00` : value).getTime();
  const days = Math.ceil((target - Date.now()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  if (days === -1) return "Yesterday";
  return `${Math.abs(days)} days ago`;
}

export default async function TodayPage() {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const now = new Date();
  const nowIso = now.toISOString();
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
    outreachResult,
  ] = await Promise.all([
    supabase
      .from("releases")
      .select("id,title,release_date,artwork_url,cover_alt,status,publish_state,active_release")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("tasks")
      .select("id,title,due_at,priority,status")
      .eq("owner_id", user.id)
      .neq("status", "Done")
      .order("due_at", { ascending: true })
      .limit(20),
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
      .from("campaigns")
      .select("id,release_id,name,status,mode")
      .eq("owner_id", user.id)
      .in("status", ["draft", "planned", "active"]),
    marketing
      .from("automation_jobs")
      .select("id,campaign_id,job_type,status,approval_status,run_after")
      .eq("owner_id", user.id)
      .in("status", ["queued", "running", "awaiting_approval"])
      .order("run_after", { ascending: true })
      .limit(30),
    marketing
      .from("publication_jobs")
      .select("id,campaign_id,platform,status,approval_status,scheduled_at")
      .eq("owner_id", user.id)
      .in("status", ["awaiting_approval", "approved", "scheduled", "publishing"])
      .order("scheduled_at", { ascending: true })
      .limit(30),
    marketing
      .from("content_items")
      .select("id,campaign_id,title,platform,status,asset_url,scheduled_at,approval_status")
      .eq("owner_id", user.id)
      .in("status", ["Draft", "In Production", "Ready", "Scheduled"])
      .order("scheduled_at", { ascending: true })
      .limit(40),
    marketing
      .from("marketing_learnings")
      .select("id,finding,status,confidence,created_at")
      .eq("owner_id", user.id)
      .in("status", ["proposed", "approved"])
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("outreach_messages")
      .select("id,contact_id,channel,follow_up_at,outreach_contacts(name)")
      .eq("owner_id", user.id)
      .not("follow_up_at", "is", null)
      .lte("follow_up_at", sevenDays.toISOString())
      .order("follow_up_at", { ascending: true })
      .limit(20),
  ]);

  const releases = releasesResult.data ?? [];
  const activeRelease =
    releases.find((release) => release.active_release) ??
    releases.find((release) => release.release_date && release.release_date >= nowIso.slice(0, 10)) ??
    releases[0] ??
    null;
  const campaignById = new Map((campaignsResult.data ?? []).map((campaign) => [campaign.id, campaign]));

  const unmatchedCount = [
    ...(soundCloudResult.data ?? []),
    ...(spotifyResult.data ?? []),
  ].filter((track) => !track.linked_track_id).length;

  const approvalJobs = (automationResult.data ?? []).filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  );
  const approvalPublications = (publicationResult.data ?? []).filter(
    (job) => job.status === "awaiting_approval" || job.approval_status === "pending",
  );
  const proposedLearnings = (learningsResult.data ?? []).filter((learning) => learning.status === "proposed");
  const missingAssets = (contentResult.data ?? []).filter(
    (item) => item.status === "Scheduled" && !item.asset_url,
  );
  const dueTasks = (tasksResult.data ?? []).filter(
    (task) => task.due_at && new Date(task.due_at) <= sevenDays,
  );
  const dueOutreach = (outreachResult.data ?? []).filter(
    (message) => message.follow_up_at && new Date(message.follow_up_at) <= sevenDays,
  );

  const needsYou = [
    ...approvalJobs.map((job) => ({
      id: `automation-${job.id}`,
      eyebrow: "Approval",
      title: `Atlas wants to run ${job.job_type.replaceAll("_", " ")}`,
      detail: "Review the proposed automation before it can continue.",
      href: job.campaign_id ? `/studio/campaigns/${job.campaign_id}` : "/studio/campaigns",
      tone: "important",
    })),
    ...approvalPublications.map((job) => ({
      id: `publication-${job.id}`,
      eyebrow: "Publish approval",
      title: `${job.platform} is ready for your decision`,
      detail: job.scheduled_at ? `Planned for ${shortDate(job.scheduled_at)}` : "Ready when you are.",
      href: job.campaign_id ? `/studio/campaigns/${job.campaign_id}` : "/studio/campaigns",
      tone: "important",
    })),
    ...(unmatchedCount
      ? [{
          id: "unmatched-catalog",
          eyebrow: "One-time decision",
          title: `${unmatchedCount} catalog item${unmatchedCount === 1 ? "" : "s"} need matching`,
          detail: "Atlas cannot safely decide which external tracks belong together.",
          href: "/studio/data-health?category=unmatched",
          tone: "warning",
        }]
      : []),
    ...missingAssets.map((item) => ({
      id: `asset-${item.id}`,
      eyebrow: "Missing asset",
      title: `${item.title} cannot publish yet`,
      detail: `${item.platform}${item.scheduled_at ? ` · ${shortDate(item.scheduled_at)}` : ""}`,
      href: `/studio/content?edit=${item.id}`,
      tone: "warning",
    })),
    ...dueOutreach.slice(0, 3).map((message) => {
      const contact = message.outreach_contacts as unknown as { name?: string } | null;
      return {
        id: `outreach-${message.id}`,
        eyebrow: "Follow-up",
        title: `Follow up with ${contact?.name || "contact"}`,
        detail: `${message.channel} · ${dateDistance(message.follow_up_at)}`,
        href: `/studio/outreach/${message.contact_id}`,
        tone: "normal",
      };
    }),
    ...dueTasks.slice(0, 3).map((task) => ({
      id: `task-${task.id}`,
      eyebrow: "Task",
      title: task.title,
      detail: task.due_at ? `${task.priority} priority · ${dateDistance(task.due_at)}` : `${task.priority} priority`,
      href: "/studio/calendar",
      tone: "normal",
    })),
    ...(proposedLearnings.length
      ? [{
          id: "learnings",
          eyebrow: "Learning",
          title: `${proposedLearnings.length} new insight${proposedLearnings.length === 1 ? "" : "s"} to review`,
          detail: "Approve only the conclusions you want Atlas to reuse in future planning.",
          href: "/studio/analytics",
          tone: "normal",
        }]
      : []),
  ].slice(0, 8);

  const workingJobs = (automationResult.data ?? []).filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  const scheduledPublications = (publicationResult.data ?? []).filter(
    (job) => job.status === "approved" || job.status === "scheduled" || job.status === "publishing",
  );
  const upcomingContent = (contentResult.data ?? []).filter(
    (item) => item.scheduled_at && new Date(item.scheduled_at) >= now && new Date(item.scheduled_at) <= sevenDays,
  );
  const approvedLearnings = (learningsResult.data ?? []).filter((learning) => learning.status === "approved");

  return (
    <div className="studio-v2-page">
      <PageHeader
        title="Today"
        description="Only the decisions that need you. Atlas handles the routine work in the background."
        action={
          <Link className="button primary" href="/studio/releases/new">
            New release
          </Link>
        }
      />

      <section className="v2-hero-grid">
        <article className="v2-focus-card">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Needs you</span>
              <h2>{needsYou.length ? `${needsYou.length} decision${needsYou.length === 1 ? "" : "s"}` : "You are clear"}</h2>
            </div>
            <span className={`v2-count ${needsYou.length ? "has-items" : ""}`}>{needsYou.length}</span>
          </div>
          {needsYou.length ? (
            <div className="v2-inbox">
              {needsYou.map((item) => (
                <Link className={`v2-inbox-item ${item.tone}`} href={item.href} key={item.id}>
                  <div>
                    <span>{item.eyebrow}</span>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <b aria-hidden>→</b>
                </Link>
              ))}
            </div>
          ) : (
            <div className="v2-calm-state">
              <strong>Nothing is blocked on you.</strong>
              <p>Atlas can keep moving with the information and approvals it already has.</p>
            </div>
          )}
        </article>

        <article className="v2-release-card">
          <span className="section-label">Next release</span>
          {activeRelease ? (
            <>
              <div className="v2-release-artwork">
                {activeRelease.artwork_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={activeRelease.artwork_url} alt={activeRelease.cover_alt || `${activeRelease.title} artwork`} />
                ) : (
                  <div aria-hidden>{activeRelease.title.slice(0, 1).toUpperCase()}</div>
                )}
              </div>
              <h2>{activeRelease.title}</h2>
              <p>{activeRelease.release_date ? `${shortDate(activeRelease.release_date)} · ${dateDistance(activeRelease.release_date)}` : "Release date not set"}</p>
              <div className="v2-release-actions">
                <Link className="button primary" href={`/studio/releases/${activeRelease.id}`}>Open release</Link>
                <Link className="button" href="/studio/calendar">Timeline</Link>
              </div>
            </>
          ) : (
            <div className="v2-calm-state">
              <strong>No release in motion</strong>
              <p>Create one workspace and Atlas will build the operational plan around it.</p>
              <Link className="button primary" href="/studio/releases/new">Create release</Link>
            </div>
          )}
        </article>
      </section>

      <section className="v2-section">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Atlas is working on</span>
            <h2>Automation, not admin</h2>
          </div>
          <Link href="/studio/settings">Automation settings</Link>
        </div>
        <div className="v2-status-grid">
          <article>
            <strong>{workingJobs.length}</strong>
            <span>automation jobs</span>
            <small>{workingJobs.length ? "Queued or running" : "No background work waiting"}</small>
          </article>
          <article>
            <strong>{scheduledPublications.length}</strong>
            <span>publication jobs</span>
            <small>{scheduledPublications.length ? "Approved or scheduled" : "Nothing scheduled to publish"}</small>
          </article>
          <article>
            <strong>{upcomingContent.length}</strong>
            <span>content moments</span>
            <small>Planned for the next 7 days</small>
          </article>
          <article>
            <strong>{campaignsResult.data?.length ?? 0}</strong>
            <span>release plans</span>
            <small>Draft, planned or active</small>
          </article>
        </div>
      </section>

      <section className="v2-two-column">
        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Next 7 days</span>
              <h2>What is coming</h2>
            </div>
            <Link href="/studio/calendar">Full timeline</Link>
          </div>
          {upcomingContent.length ? (
            <div className="v2-simple-list">
              {upcomingContent.slice(0, 6).map((item) => (
                <Link href={`/studio/content?edit=${item.id}`} key={item.id}>
                  <span>{shortDate(item.scheduled_at)}</span>
                  <strong>{item.title}</strong>
                  <small>{item.platform}</small>
                </Link>
              ))}
            </div>
          ) : (
            <div className="v2-calm-state compact">
              <strong>No scheduled content this week.</strong>
              <p>Atlas will surface planned items here as the release plan fills in.</p>
            </div>
          )}
        </article>

        <article className="v2-section v2-compact-section">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">What worked</span>
              <h2>Reusable learnings</h2>
            </div>
            <Link href="/studio/analytics">See performance</Link>
          </div>
          {approvedLearnings.length ? (
            <div className="v2-learning-list">
              {approvedLearnings.slice(0, 4).map((learning) => (
                <div key={learning.id}>
                  <strong>{Math.round(learning.confidence * 100)}%</strong>
                  <p>{learning.finding}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="v2-calm-state compact">
              <strong>No approved learnings yet.</strong>
              <p>As campaigns collect evidence, Atlas will suggest what should influence the next release.</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
