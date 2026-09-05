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
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { evidenceStrengthLabel } from "@/lib/studio/evidence-labels";
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
  const artist = await resolveDefaultArtistContext(supabase, user);
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
  const growthTabs = [
    { label: "Overview", href: href("/studio/growth"), active: view === "overview" },
    { label: "Opportunities", href: href("/studio/growth?view=opportunities"), active: view === "opportunities" },
    { label: "Performance", href: href("/studio/growth?view=performance"), active: view === "performance" },
    { label: "Paid experiments", href: href("/studio/growth/paid"), active: false },
    { label: "Learnings", href: href("/studio/learn"), active: false },
  ];

  return (
    <div className="studio-v2-page growth-polish-page">
      <PageHeader
        title="Grow"
        description={`Turn ${artist.artistName}'s attention into durable listening and fan relationships. Ensemblis surfaces evidence, the next useful action and what it learned, while keeping campaign machinery out of the way.`}
        action={view === "overview"
          ? <form action={generateGrowthPlan}><button className="button primary" type="submit">Refresh recommendations</button></form>
          : view === "opportunities"
            ? <form action={refreshGrowthOpportunities}><button className="button primary" type="submit">Scan for evidence</button></form>
            : undefined}
      />

      <nav className="growth-polish-tabs" aria-label="Grow workspace">
        {growthTabs.map((tab) => <Link className={tab.active ? "active" : ""} href={tab.href} key={tab.label}>{tab.label}</Link>)}
      </nav>

      {view === "overview" ? <>
        <section className="growth-polish-north-star" aria-label="Current audience evidence">
          <div><span className="section-label">Audience evidence</span><strong>{funnel.listeners.toLocaleString()}</strong><small>listeners in the connected performance window</small></div>
          <div><strong>{funnel.saves.toLocaleString()}</strong><span>saves</span></div>
          <div><strong>{funnel.follows.toLocaleString()}</strong><span>follows</span></div>
          <div><strong>{funnel.playlistAdds.toLocaleString()}</strong><span>playlist adds</span></div>
          <div><strong>{funnel.linkClicks.toLocaleString()}</strong><span>owned-link clicks</span></div>
        </section>

        <div className="growth-command-grid">
          <article className="v2-section growth-recommendation">
            <div className="v2-section-heading"><div><span className="section-label">Recommended next release</span><h2>{topCandidate ? topCandidate.track.title : "No release candidate needs promotion"}</h2></div></div>
            {topCandidate ? <>
              <p>{topCandidate.reasons.join(" · ")}</p>
              <div className="growth-chip-row"><span>{titleCase(topCandidate.track.status)}</span><span>{evidenceStrengthLabel(topCandidate.track.analysis_confidence)}</span></div>
              <div className="actions"><form action={promoteVaultTrack}><input type="hidden" name="id" value={topCandidate.track.id} /><button className="button primary" type="submit">Start a release Mission</button></form><Link className="button" href={href("/studio/music")}>Inspect music evidence</Link></div>
            </> : <div className="v2-calm-state compact"><strong>Nothing needs promotion.</strong><p>Music owns the source backlog. When a mastered track has enough evidence to justify a release slot, Ensemblis will surface it here.</p><Link className="button" href={href("/studio/music")}>Open Music</Link></div>}
          </article>

          <article className="v2-section growth-bottleneck">
            <div className="v2-section-heading"><div><span className="section-label">Growth diagnosis</span><h2>{diagnosis ? diagnosis.label : "Need more signal"}</h2></div></div>
            {diagnosis ? <><div className="growth-rate-compare"><div><strong>{percent(diagnosis.actual)}</strong><span>observed</span></div><div><strong>{percent(diagnosis.target)}</strong><span>working benchmark</span></div></div><p>{diagnosis.diagnosis}</p><div className="growth-action-note"><strong>Do next</strong><span>{diagnosis.action}</span></div><Link className="growth-inline-link" href={href("/studio/growth?view=performance")}>Inspect evidence →</Link></> : <div className="v2-calm-state compact"><strong>No clear bottleneck yet.</strong><p>Connect more performance data. Ensemblis will wait for evidence instead of manufacturing a growth task.</p></div>}
          </article>
        </div>

        <section className="v2-section growth-polish-plan-preview">
          <div className="v2-section-heading"><div><span className="section-label">Release system</span><h2>What is already in motion</h2></div><Link href={href("/studio/calendar")}>Open calendar</Link></div>
          <div className="growth-queue">
            {scheduledReleases.slice(0, 3).map((release) => <Link href={href(`/studio/releases/${release.id}`)} className="growth-queue-item locked" key={`release-${release.id}`}><span className="growth-queue-date">{shortDate(release.release_date)}</span><div><small>Committed release</small><strong>{release.title}</strong><p>{release.status} · Ensemblis plans around this date.</p></div><b>Locked</b></Link>)}
            {plan.slice(0, 4).map((item) => {
              const track = item.track_vault_id ? vaultById.get(item.track_vault_id) : null;
              const release = item.release_id ? releaseById.get(item.release_id) : null;
              const target = track?.title || release?.title || "Portfolio item";
              return <div className="growth-queue-item" key={item.id}><span className="growth-queue-date">{shortDate(item.target_date)}</span><div><small>{titleCase(item.status)}</small><strong>{target}</strong><p>{item.rationale}</p></div>{track && !track.linked_release_id ? <form action={promoteVaultTrack}><input type="hidden" name="id" value={track.id} /><button className="button" type="submit">Use this slot</button></form> : <span />}</div>;
            })}
            {!scheduledReleases.length && !plan.length ? <div className="v2-calm-state compact"><strong>No release plan yet.</strong><p>Refresh recommendations. Existing release dates stay authoritative; Ensemblis only suggests safe gaps.</p></div> : null}
          </div>
        </section>

        <section className="v2-section growth-polish-opportunity-preview">
          <div className="v2-section-heading"><div><span className="section-label">In motion</span><h2>{acceptedOpportunities.length ? `${acceptedOpportunities.length} evidence-backed opportunit${acceptedOpportunities.length === 1 ? "y" : "ies"}` : "No extra growth experiment is active"}</h2></div><Link href={href("/studio/growth?view=opportunities")}>Review opportunities</Link></div>
          {acceptedOpportunities.length ? <div className="growth-polish-simple-list">{acceptedOpportunities.slice(0, 4).map((item) => <div key={item.id}><span>{titleCase(item.kind)}</span><strong>{item.title}</strong><small>{evidenceStrengthLabel(Number(item.confidence))}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>Nothing extra needs activation.</strong><p>Ensemblis will surface catalog, creative or funnel opportunities only when there is evidence worth acting on.</p></div>}
        </section>

        <details className="v2-section v2-compact-section">
          <summary><strong>Advanced planning tools</strong><span>Campaign calendar, portfolio diagnostics and growth rules</span></summary>
          <div className="actions"><Link className="button" href={href("/studio/campaigns")}>Campaigns</Link><Link className="button" href={href("/studio/calendar")}>Calendar</Link><Link className="button" href={href("/studio/growth?view=portfolio")}>Portfolio diagnostics</Link></div>
        </details>
      </> : null}

      {view === "opportunities" ? <section className="v2-section growth-polish-view-section" id="opportunities">
        <div className="v2-section-heading"><div><span className="section-label">Evidence-backed opportunities</span><h2>What may be worth doing next</h2></div></div>
        {opportunities.length ? <div className="growth-opportunity-grid">{opportunities.map((opportunity) => <article className={`growth-opportunity ${opportunity.status === "accepted" ? "accepted" : ""}`} key={opportunity.id}><div className="growth-opportunity-head"><span>{titleCase(opportunity.kind)}</span><strong>{priorityLabel(Number(opportunity.priority))}</strong></div><h3>{opportunity.title}</h3><p>{opportunity.rationale}</p><small>{evidenceStrengthLabel(Number(opportunity.confidence))} · {opportunity.status === "accepted" ? "In motion" : "Needs a decision"}</small><div className="actions">{opportunity.status === "new" ? <form action={activateGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button primary" type="submit">Use this opportunity</button></form> : <span className="growth-active-label">In motion</span>}{opportunity.status === "new" ? <form action={dismissGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button" type="submit">Not useful</button></form> : null}{opportunity.release_id ? <Link className="button" href={href(`/studio/releases/${opportunity.release_id}`)}>Open release</Link> : null}</div></article>)}</div> : <div className="v2-calm-state compact"><strong>No active opportunity alerts.</strong><p>Run a scan after performance data changes. Ensemblis will not create opportunities just to fill the screen.</p></div>}
      </section> : null}

      {view === "performance" ? <section className="v2-section growth-polish-view-section" id="funnel">
        <div className="v2-section-heading"><div><span className="section-label">Audience funnel</span><h2>Where attention turns into fandom</h2></div><Link href={href("/studio/analytics")}>Full analytics</Link></div>
        <div className="growth-funnel"><article><span>Discovery</span><strong>{funnel.reach.toLocaleString()}</strong><small>qualified reach / views</small></article><i>→</i><article><span>Curiosity</span><strong>{funnel.profileVisits.toLocaleString()}</strong><small>{percent(funnel.profileVisitRate)} reach → profile</small></article><i>→</i><article><span>Music intent</span><strong>{funnel.linkClicks.toLocaleString()}</strong><small>{percent(funnel.linkClickRate)} profile → owned link</small></article><i>→</i><article><span>Listening</span><strong>{funnel.listeners.toLocaleString()}</strong><small>{funnel.streamsPerListener ? `${Math.round(funnel.streamsPerListener * 10) / 10} streams / listener` : "listener data needed"}</small></article><i>→</i><article><span>Fandom</span><strong>{(funnel.saves + funnel.follows + funnel.playlistAdds).toLocaleString()}</strong><small>{percent(funnel.saveRate)} save · {percent(funnel.followRate)} follow</small></article></div>
        {diagnosis ? <div className="growth-action-note growth-performance-diagnosis"><strong>Current constraint</strong><span>{diagnosis.diagnosis} {diagnosis.action}</span></div> : null}
        <div className="actions"><Link className="button primary" href={href("/studio/growth/paid")}>Run a bounded paid experiment</Link><Link className="button" href={href("/studio/sites/smart-links")}>Inspect owned attribution</Link></div>
      </section> : null}

      {view === "portfolio" ? <>
        <section className="v2-section growth-polish-view-section" id="portfolio-diagnostics">
          <div className="v2-section-heading"><div><span className="section-label">Advanced diagnostics</span><h2>Release-candidate ordering</h2></div><Link href={href("/studio/music")}>Edit music source data</Link></div>
          <p className="v2-muted-copy">This ordering is internal decision support. The artist-facing recommendation is the evidence and next action, not a synthetic score.</p>
          {ranked.length ? <div className="growth-polish-simple-list">{ranked.slice(0, 12).map((item, index) => <div key={item.track.id}><span>{index === 0 && item.eligible ? "Best current fit" : item.eligible ? "Candidate" : "Hold"}</span><strong>{item.track.title}</strong><small>{item.blocker || item.reasons.join(" · ") || titleCase(item.track.status)}</small></div>)}</div> : <div className="v2-calm-state compact"><strong>No source tracks yet.</strong><p>Add mastered music in Music. Track Intelligence will populate the evidence used here.</p></div>}
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