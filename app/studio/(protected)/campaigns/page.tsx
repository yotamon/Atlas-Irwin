/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { createCampaign } from "@/app/studio/marketing-actions";
import styles from "@/components/studio/marketing-workspace.module.css";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asMarketingClient } from "@/lib/marketing/db";
import { CAMPAIGN_MODES, MARKETING_OBJECTIVES } from "@/lib/marketing/domain";
import type { Json } from "@/types/database";

function strategySummary(strategy: Json) {
  if (!strategy || typeof strategy !== "object" || Array.isArray(strategy)) return "";
  const value = strategy.strategySummary;
  return typeof value === "string" ? value : "";
}

function dayLabel(value: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value));
}

export default async function CampaignsPage() {
  const { supabase, user } = await requireStudioAdmin();
  const marketing = asMarketingClient(supabase);
  const [releasesResult, campaignsResult, experimentsResult, contentResult, variantsResult, jobsResult] = await Promise.all([
    supabase.from("releases").select("id,title,release_date,artwork_url,primary_hook,core_emotion,status").eq("owner_id", user.id).order("release_date", { ascending: false }),
    marketing.from("campaigns").select("*").eq("owner_id", user.id).order("updated_at", { ascending: false }),
    marketing.from("campaign_experiments").select("id,campaign_id,status").eq("owner_id", user.id),
    marketing.from("content_items").select("id,campaign_id,status,scheduled_at,approval_status").eq("owner_id", user.id),
    marketing.from("content_variants").select("id,content_item_id,approval_status,status").eq("owner_id", user.id),
    marketing.from("publication_jobs").select("id,campaign_id,status").eq("owner_id", user.id),
  ]);
  if (releasesResult.error) throw new Error(releasesResult.error.message);
  if (campaignsResult.error) throw new Error(campaignsResult.error.message);
  if (experimentsResult.error) throw new Error(experimentsResult.error.message);
  if (contentResult.error) throw new Error(contentResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (jobsResult.error) throw new Error(jobsResult.error.message);

  const releases = releasesResult.data ?? [];
  const campaigns = campaignsResult.data ?? [];
  const experiments = experimentsResult.data ?? [];
  const content = contentResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const jobs = jobsResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const activeCampaigns = campaigns.filter((campaign) => ["planned", "active", "paused"].includes(campaign.status));
  const runningExperiments = experiments.filter((experiment) => ["running", "evaluating"].includes(experiment.status)).length;
  const pendingApprovals = variants.filter((variant) => variant.approval_status === "pending" && variant.status !== "rejected").length;
  const now = new Date().getTime();
  const sevenDays = now + 7 * 24 * 60 * 60 * 1000;
  const dueSoon = content.filter((item) => {
    if (!item.scheduled_at || item.status === "Published" || item.status === "Archived") return false;
    const time = new Date(item.scheduled_at).getTime();
    return time >= now && time <= sevenDays;
  }).length;

  return (
    <div className={styles.shell}>
      <PageHeader
        title="Campaign Brain"
        description="Plan releases as experiments, approve the right creative, keep timing relative to release day, and feed real performance back into the next decision."
        action={
          <div className="actions">
            <Link className="button" href="/studio/content">Content Lab</Link>
            <Link className="button" href="/studio/analytics">Analytics</Link>
          </div>
        }
      />

      <div className={styles.statGrid}>
        <div className={styles.stat}><span>Campaigns in motion</span><strong>{activeCampaigns.length}</strong><small>Planned, active or paused</small></div>
        <div className={styles.stat}><span>Experiments learning</span><strong>{runningExperiments}</strong><small>Running or awaiting enough signal</small></div>
        <div className={styles.stat}><span>Creative approvals</span><strong>{pendingApprovals}</strong><small>AI never silently promotes a draft</small></div>
        <div className={styles.stat}><span>Next 7 days</span><strong>{dueSoon}</strong><small>Release-relative content moments</small></div>
      </div>

      <section>
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>Campaign intelligence</span><h2>Release systems</h2></div>
          <p>Each campaign owns its objective, phases, experiments, variants, attribution and automation state.</p>
        </div>
        {campaigns.length ? (
          <div className={styles.campaignGrid}>
            {campaigns.map((campaign) => {
              const release = campaign.release_id ? releaseById.get(campaign.release_id) : undefined;
              const campaignContent = content.filter((item) => item.campaign_id === campaign.id);
              const campaignExperiments = experiments.filter((item) => item.campaign_id === campaign.id);
              const campaignJobs = jobs.filter((job) => job.campaign_id === campaign.id);
              const summary = strategySummary(campaign.strategy) || release?.primary_hook || release?.core_emotion || "Generate a campaign strategy to define the testable creative direction.";
              const published = campaignContent.filter((item) => item.status === "Published").length;
              const awaiting = campaignJobs.filter((job) => job.status === "awaiting_approval").length;
              return (
                <Link className={styles.campaignCard} href={`/studio/campaigns/${campaign.id}`} key={campaign.id}>
                  {release?.artwork_url ? <img className={styles.campaignArt} src={release.artwork_url} alt="" /> : <span className={styles.campaignArtEmpty} />}
                  <div>
                    <span className={styles.eyebrow}>{campaign.status} / {campaign.mode}</span>
                    <h2>{campaign.name}</h2>
                    <p>{summary}</p>
                    <div className={styles.campaignMeta}>
                      <span className={styles.chip}>{campaign.objective}</span>
                      <span className={styles.chip}>KPI: {campaign.primary_kpi}</span>
                      <span className={styles.chip}>{campaignExperiments.length} experiments</span>
                      <span className={styles.chip}>{published}/{campaignContent.length} published</span>
                      {awaiting ? <span className={styles.statusChip}>{awaiting} approvals</span> : null}
                      <span className={styles.chip}>{dayLabel(campaign.release_anchor_date)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyBrain}>
            <div>
              <span className={styles.eyebrow}>No first-class campaign yet</span>
              <h2>Start with an objective</h2>
              <p>Your existing releases and content stay intact. Create a Campaign Brain record for the next release, then generate a strategy only when you explicitly choose to spend an AI call.</p>
            </div>
          </div>
        )}
      </section>

      <section className={styles.panel} id="new">
        <div className={styles.sectionHead}>
          <div><span className={styles.eyebrow}>New campaign</span><h2>Define the job</h2></div>
          <p>The release date becomes the schedule anchor. If it moves later, unfinished campaign timing moves with it automatically.</p>
        </div>
        <form action={createCampaign} className={styles.createGrid}>
          <label className="field"><span>Release</span><select name="release_id" required defaultValue=""><option value="" disabled>Select release</option>{releases.map((release) => <option value={release.id} key={release.id}>{release.title}{release.release_date ? ` / ${release.release_date}` : ""}</option>)}</select></label>
          <label className="field"><span>Campaign name</span><input name="name" placeholder="Defaults to release title" /></label>
          <label className="field"><span>Primary objective</span><select name="objective" defaultValue="Streams">{MARKETING_OBJECTIVES.map((objective) => <option key={objective}>{objective}</option>)}</select></label>
          <label className="field"><span>Automation mode</span><select name="mode" defaultValue="assisted">{CAMPAIGN_MODES.map((mode) => <option key={mode} value={mode}>{mode === "suggest" ? "Suggest only" : mode === "assisted" ? "Assisted / approval gates" : "Autopilot where safe"}</option>)}</select></label>
          <button className="button primary" type="submit">Create campaign</button>
        </form>
      </section>
    </div>
  );
}
