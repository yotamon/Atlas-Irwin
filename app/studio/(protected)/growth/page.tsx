import Link from "next/link";
import {
  activateGrowthOpportunity,
  dismissGrowthOpportunity,
  generateGrowthPlan,
  promoteVaultTrack,
  refreshGrowthOpportunities,
  saveGrowthSettings,
} from "@/app/studio/growth-actions";
import { PageHeader } from "@/components/studio/ui";
import { CompactEvidence } from "@/components/studio/ux-v4-widgets";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { buildGrowthFunnel, diagnoseGrowthFunnel, rankVaultTracks } from "@/lib/studio/growth";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import type { GrowthSettings } from "@/types/growth-database";

const DEFAULT_SETTINGS: Pick<GrowthSettings, "north_star" | "planning_horizon_days" | "release_cadence_days" | "minimum_candidate_score" | "catalog_engine_enabled" | "autoplan_enabled"> = {
  north_star: "active_fanbase",
  planning_horizon_days: 90,
  release_cadence_days: 28,
  minimum_candidate_score: 55,
  catalog_engine_enabled: true,
  autoplan_enabled: true,
};

type GrowthView = "overview" | "opportunities" | "performance" | "portfolio";

function shortDate(value: string | null | undefined) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "Europe/Berlin" })
    .format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function priorityLabel(priority: number) {
  if (priority >= 80) return "High leverage";
  if (priority >= 50) return "Worth testing";
  return "Optional";
}

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const view: GrowthView = ["opportunities", "performance", "portfolio"].includes(params.view ?? "")
    ? params.view as GrowthView
    : "overview";
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const growth = asGrowthClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const marketing = asMarketingClient(supabase);
  const [settingsResult, vaultResult, planResult, opportunityResult, releasesResult, metricsResult] = await Promise.all([
    growth.from("artist_growth_settings").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).neq("status", "archived").order("updated_at", { ascending: false }),
    growth.from("growth_plan_items").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["proposed", "accepted", "scheduled"]).order("target_date").order("sort_order"),
    growth.from("growth_opportunities").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["new", "accepted"]).order("priority", { ascending: false }).order("detected_at", { ascending: false }),
    music.from("releases").select("id,title,status,release_date,artwork_url").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("release_date", { ascending: true }),
    marketing.from("metric_snapshots").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
  ]);
  const firstError = [settingsResult, vaultResult, planResult, opportunityResult, releasesResult, metricsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const settings = settingsResult.data ?? DEFAULT_SETTINGS;
  const vault = vaultResult.data ?? [];
  const ranked = rankVaultTracks(vault);
  const topCandidate = ranked.find((item) => item.eligible && !item.track.linked_release_id) ?? null;
  const releases = releasesResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release]));
  const vaultById = new Map(vault.map((track) => [track.id, track]));
  const plan = planResult.data ?? [];
  const opportunities = opportunityResult.data ?? [];
  const metrics = metricsResult.data ?? [];
  const funnel = buildGrowthFunnel(metrics);
  const diagnosis = diagnoseGrowthFunnel(funnel);
  const nowDate = new Date().toISOString().slice(0, 10);
  const scheduledReleases = releases.filter((release) => release.release_date && release.release_date >= nowDate && ["Idea", "In Progress", "Scheduled"].includes(release.status));
  const acceptedOpportunities = opportunities.filter((item) => item.status === "accepted");
  const newOpportunities = opportunities.filter((item) => item.status === "new");
  const growthTabs = [
    { label: "Overview", href: href("/studio/growth"), active: view === "overview" },
    { label: "Opportunities", href: href("/studio/growth?view=opportunities"), active: view === "opportunities" },
    { label: "Audience", href: href("/studio/audience"), active: false },
    { label: "Performance", href: href("/studio/growth?view=performance"), active: view === "performance" },
  ];

  return (
    <div className="studio-v2-page growth-polish-page">
      <PageHeader title="Grow" description={`What is working for ${artist.artistName}, what is not, and what to do next.`} />

      <nav className="growth-polish-tabs" aria-label="Grow workspace">
        {growthTabs.map((tab) => <Link className={tab.active ? "active" : ""} href={tab.href} key={tab.label}>{tab.label}</Link>)}
      </nav>

      {view === "overview" ? <div className="growth-v5-overview">
        <section className="v2-section growth-v5-recommendation growth-human-factors-recommendation">
          <div className="v2-section-heading">
            <div>
              <span className="section-label">Recommended next action</span>
              <h2>{topCandidate ? `Prepare ${topCandidate.track.title} for release` : diagnosis ? diagnosis.label : "No urgent growth action"}</h2>
              <p>{topCandidate ? topCandidate.reasons.join(" · ") : diagnosis ? diagnosis.diagnosis : "Ensemblis is waiting for enough evidence before changing direction."}</p>
            </div>
          </div>
          {topCandidate ? (
            <div className="actions">
              <form action={promoteVaultTrack}><input type="hidden" name="id" value={topCandidate.track.id} /><button className="button primary" type="submit">Start release plan</button></form>
              <Link className="button" href={href(`/studio/music/${topCandidate.track.id}`)}>Open track</Link>
            </div>
          ) : diagnosis ? (
            <div className="actions"><Link className="button primary" href={href("/studio/growth?view=performance")}>See why and act</Link></div>
          ) : (
            <div className="v2-calm-state compact growth-human-factors-calm">
              <strong>Nothing needs a growth decision right now.</strong>
              <p>That is a successful state. Ensemblis will surface a next move when the evidence is strong enough.</p>
            </div>
          )}
          <CompactEvidence label="Why this recommendation?">
            <p>{topCandidate
              ? topCandidate.reasons.join(" · ")
              : diagnosis
                ? `${diagnosis.diagnosis} ${diagnosis.action}`
                : "There is not enough trustworthy signal to justify changing direction yet."}</p>
            {newOpportunities.length ? <p><Link href={href("/studio/growth?view=opportunities")}>Review {newOpportunities.length} other opportunit{newOpportunities.length === 1 ? "y" : "ies"}</Link></p> : null}
          </CompactEvidence>
        </section>

        <section className="v2-section growth-v5-in-motion growth-human-factors-progress">
          <div className="v2-section-heading compact">
            <div><span className="section-label">Already moving</span><h2>Current work</h2></div>
            <Link href={href("/studio/calendar")}>Calendar</Link>
          </div>
          {(scheduledReleases.length || acceptedOpportunities.length || plan.length) ? (
            <div className="growth-queue">
              {scheduledReleases.slice(0, 2).map((release) => <Link href={href(`/studio/releases/${release.id}`)} className="growth-queue-item locked" key={`release-${release.id}`}><span className="growth-queue-date">{shortDate(release.release_date)}</span><div><small>Release</small><strong>{release.title}</strong><p>{release.status}</p></div><b>Open</b></Link>)}
              {acceptedOpportunities.slice(0, 1).map((item) => <div className="growth-queue-item" key={`opportunity-${item.id}`}><span className="growth-queue-date">Active</span><div><small>{titleCase(item.kind)}</small><strong>{item.title}</strong><p>{item.rationale}</p></div><span /></div>)}
              {plan.slice(0, 1).map((item) => {
                const track = item.track_vault_id ? vaultById.get(item.track_vault_id) : null;
                const release = item.release_id ? releaseById.get(item.release_id) : null;
                return <div className="growth-queue-item" key={item.id}><span className="growth-queue-date">{shortDate(item.target_date)}</span><div><small>{titleCase(item.status)}</small><strong>{track?.title || release?.title || "Planned work"}</strong><p>{item.rationale}</p></div><span /></div>;
              })}
            </div>
          ) : <div className="v2-calm-state compact"><strong>Nothing extra is running.</strong><p>Ensemblis will add work when the artist context justifies it.</p></div>}
        </section>

        <section className="v2-section growth-human-factors-context">
          <div className="v2-section-heading compact">
            <div><span className="section-label">Current signal</span><h2>{diagnosis ? diagnosis.label : "Learning from the audience"}</h2></div>
          </div>
          <div className="growth-human-factors-signal">
            <div><strong>{funnel.listeners.toLocaleString()}</strong><span>listeners</span></div>
            <div><strong>{funnel.saves.toLocaleString()}</strong><span>saves</span></div>
            <div><strong>{funnel.follows.toLocaleString()}</strong><span>follows</span></div>
          </div>
          <p className="v2-muted-copy">{diagnosis ? diagnosis.diagnosis : "More trustworthy performance data is needed before Ensemblis names a growth bottleneck."}</p>
          <div className="actions">
            <Link href={href("/studio/audience")}>Audience</Link>
            <Link href={href("/studio/growth?view=performance")}>Performance</Link>
          </div>
        </section>

        <details className="v2-section v2-compact-section">
          <summary><strong>Advanced growth tools</strong><span>Paid tests, planning controls, campaign detail and learning evidence</span></summary>
          <div className="actions"><Link className="button" href={href("/studio/growth/paid")}>Paid tests</Link><Link className="button" href={href("/studio/learn")}>Learnings</Link><Link className="button" href={href("/studio/campaigns")}>Campaigns</Link><Link className="button" href={href("/studio/calendar")}>Calendar</Link><Link className="button" href={href("/studio/growth?view=portfolio")}>Planning details</Link></div>
        </details>
      </div> : null}
      {view === "opportunities" ? <section className="v2-section growth-polish-view-section" id="opportunities">
        <div className="v2-section-heading"><div><span className="section-label">Opportunities</span><h2>What may be worth doing next</h2></div></div>
        {opportunities.length ? <div className="growth-opportunity-grid">{opportunities.map((opportunity) => <article className={`growth-opportunity ${opportunity.status === "accepted" ? "accepted" : ""}`} key={opportunity.id}><div className="growth-opportunity-head"><span>{titleCase(opportunity.kind)}</span><strong>{priorityLabel(Number(opportunity.priority))}</strong></div><h3>{opportunity.title}</h3><p>{opportunity.rationale}</p><small>{opportunity.status === "accepted" ? "In motion" : "Needs a decision"}</small><div className="actions">{opportunity.status === "new" ? <form action={activateGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button primary" type="submit">Use this opportunity</button></form> : <span className="growth-active-label">In motion</span>}{opportunity.status === "new" ? <form action={dismissGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button" type="submit">Not useful</button></form> : null}{opportunity.release_id ? <Link className="button" href={href(`/studio/releases/${opportunity.release_id}`)}>Open release</Link> : null}</div></article>)}</div> : <div className="v2-calm-state compact"><strong>No active opportunity alerts.</strong><p>New opportunities appear when the signal is strong enough. Manual refresh stays in Advanced.</p></div>}
      </section> : null}

      {view === "performance" ? <section className="v2-section growth-polish-view-section" id="funnel">
        <div className="v2-section-heading"><div><span className="section-label">Audience funnel</span><h2>Where attention turns into fandom</h2></div><div className="actions"><Link href={href("/studio/audience")}>Open Audience</Link><Link href={href("/studio/analytics")}>Detailed analytics</Link></div></div>
        <div className="growth-funnel"><article><span>Discovery</span><strong>{funnel.reach.toLocaleString()}</strong><small>qualified reach / views</small></article><i>→</i><article><span>Curiosity</span><strong>{funnel.profileVisits.toLocaleString()}</strong><small>{percent(funnel.profileVisitRate)} reach → profile</small></article><i>→</i><article><span>Music intent</span><strong>{funnel.linkClicks.toLocaleString()}</strong><small>{percent(funnel.linkClickRate)} profile → owned link</small></article><i>→</i><article><span>Listening</span><strong>{funnel.listeners.toLocaleString()}</strong><small>{funnel.streamsPerListener ? `${Math.round(funnel.streamsPerListener * 10) / 10} streams / listener` : "listener data needed"}</small></article><i>→</i><article><span>Fandom</span><strong>{(funnel.saves + funnel.follows + funnel.playlistAdds).toLocaleString()}</strong><small>{percent(funnel.saveRate)} save · {percent(funnel.followRate)} follow</small></article></div>
        {diagnosis ? <div className="growth-action-note growth-performance-diagnosis"><strong>Current constraint</strong><span>{diagnosis.diagnosis} {diagnosis.action}</span></div> : null}
        <div className="actions"><Link className="button primary" href={href("/studio/growth/paid")}>Run a paid test</Link><Link className="button" href={href("/studio/sites/smart-links")}>Owned attribution</Link></div>
      </section> : null}

      {(view === "overview" || view === "opportunities") ? (
        <details className="v2-advanced-disclosure">
          <summary>Advanced data controls</summary>
          <p className="v2-muted-copy">These controls are for an immediate manual refresh, not a routine step in the growth workflow.</p>
          <div className="actions">
            {view === "overview" ? <form action={generateGrowthPlan}><button className="button" type="submit">Refresh recommendations now</button></form> : null}
            {view === "opportunities" ? <form action={refreshGrowthOpportunities}><button className="button" type="submit">Check for new opportunities</button></form> : null}
          </div>
        </details>
      ) : null}

      {view === "portfolio" ? <>
        <section className="v2-section growth-polish-view-section" id="portfolio-diagnostics">
          <div className="v2-section-heading"><div><span className="section-label">Advanced diagnostics</span><h2>Release-candidate ordering</h2></div><Link href={href("/studio/music")}>Edit music source data</Link></div>
          <p className="v2-muted-copy">This advanced ordering supports planning. The normal Grow view shows the recommendation and next action instead of a synthetic score.</p>
          {ranked.length ? <div className="growth-polish-simple-list">{ranked.slice(0, 12).map((item, index) => <div key={item.track.id}><span>{index === 0 && item.eligible ? "Best current fit" : item.eligible ? "Candidate" : "Hold"}</span><strong>{item.track.title}</strong><small>{item.blocker || item.reasons.join(" · ") || titleCase(item.track.status)}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>No source tracks yet.</strong><p>Add mastered music in Music.</p></div>}
        </section>

        <section className="v2-section growth-settings growth-polish-rules">
          <div className="v2-section-heading"><div><span className="section-label">Planning posture</span><h2>How should Ensemblis space release recommendations?</h2></div></div>
          <form action={saveGrowthSettings} className="growth-settings-form">
            <label><span>Planning horizon</span><input type="number" min="30" max="365" name="planning_horizon_days" defaultValue={settings.planning_horizon_days} /><small>days</small></label>
            <label><span>Release cadence</span><input type="number" min="7" max="120" name="release_cadence_days" defaultValue={settings.release_cadence_days} /><small>days</small></label>
            <input type="hidden" name="minimum_candidate_score" value={settings.minimum_candidate_score} />
            <label className="growth-toggle"><input type="checkbox" name="catalog_engine_enabled" defaultChecked={settings.catalog_engine_enabled} /><span>Detect catalog opportunities when evidence changes</span></label>
            <label className="growth-toggle"><input type="checkbox" name="autoplan_enabled" defaultChecked={settings.autoplan_enabled} /><span>Maintain a safe internal portfolio plan</span></label>
            <button className="button primary" type="submit">Save planning posture</button>
          </form>
        </section>
      </> : null}
    </div>
  );
}
