import Link from "next/link";
import {
  activateGrowthOpportunity,
  archiveVaultTrack,
  dismissGrowthOpportunity,
  generateGrowthPlan,
  promoteVaultTrack,
  refreshGrowthOpportunities,
  saveGrowthSettings,
  saveVaultTrack,
} from "@/app/studio/growth-actions";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
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
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}
function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
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
    { label: "Campaigns", href: href("/studio/campaigns"), active: false },
    { label: "Calendar", href: href("/studio/calendar"), active: false },
    { label: "Opportunities", href: href("/studio/growth?view=opportunities"), active: view === "opportunities" },
    { label: "Performance", href: href("/studio/growth?view=performance"), active: view === "performance" },
    { label: "Learnings", href: href("/studio/learn"), active: false },
  ];

  return (
    <div className="studio-v2-page growth-polish-page">
      <PageHeader
        title="Grow"
        description={`Turn ${artist.artistName}'s attention into a healthier audience and release system. Ensemblis keeps planning, opportunities and performance separate so each screen answers one question.`}
        action={view === "overview" ? <form action={generateGrowthPlan}><button className="button primary" type="submit">Recalculate plan</button></form> : view === "opportunities" ? <form action={refreshGrowthOpportunities}><button className="button primary" type="submit">Scan opportunities</button></form> : undefined}
      />

      <nav className="growth-polish-tabs" aria-label="Grow workspace">
        {growthTabs.map((tab) => <Link className={tab.active ? "active" : ""} href={tab.href} key={tab.label}>{tab.label}</Link>)}
      </nav>

      {view === "overview" ? (
        <>
          <section className="growth-polish-north-star">
            <div><span className="section-label">Active fan signal</span><strong>{funnel.fanSignalScore.toLocaleString()}</strong><small>weighted saves, follows, playlist adds and repeat listening</small></div>
            <div><strong>{funnel.listeners.toLocaleString()}</strong><span>listeners</span></div>
            <div><strong>{funnel.saves.toLocaleString()}</strong><span>saves</span></div>
            <div><strong>{funnel.follows.toLocaleString()}</strong><span>follows</span></div>
            <div><strong>{funnel.playlistAdds.toLocaleString()}</strong><span>playlist adds</span></div>
          </section>

          <div className="growth-command-grid">
            <article className="v2-section growth-recommendation">
              <div className="v2-section-heading"><div><span className="section-label">Release intelligence</span><h2>What should move next?</h2></div></div>
              {topCandidate ? (
                <>
                  <div className="growth-candidate-score"><strong>{Math.round(topCandidate.score)}</strong><span>/100 portfolio score</span></div>
                  <h3>{topCandidate.track.title}</h3>
                  <p>{topCandidate.reasons.join(" · ")}</p>
                  <div className="growth-chip-row"><span>{titleCase(topCandidate.track.status)}</span><span>Hook {topCandidate.track.hook_strength}</span><span>Short-form {topCandidate.track.short_form_potential}</span><span>Unique {topCandidate.track.uniqueness_score}</span></div>
                  <div className="actions"><form action={promoteVaultTrack}><input type="hidden" name="id" value={topCandidate.track.id} /><button className="button primary" type="submit">Promote to release</button></form><Link className="button" href={href("/studio/music")}>Open Music</Link></div>
                </>
              ) : <div className="v2-calm-state compact"><strong>No eligible unreleased candidate yet.</strong><p>Music owns the track backlog now. Add or analyze source material there and Grow will rank what is actually ready.</p><Link className="button" href={href("/studio/music")}>Open Music</Link></div>}
            </article>

            <article className="v2-section growth-bottleneck">
              <div className="v2-section-heading"><div><span className="section-label">Growth diagnosis</span><h2>{diagnosis ? diagnosis.label : "Need more signal"}</h2></div></div>
              {diagnosis ? <><div className="growth-rate-compare"><div><strong>{percent(diagnosis.actual)}</strong><span>current</span></div><div><strong>{percent(diagnosis.target)}</strong><span>working target</span></div></div><p>{diagnosis.diagnosis}</p><div className="growth-action-note"><strong>Do next</strong><span>{diagnosis.action}</span></div><Link className="growth-inline-link" href={href("/studio/growth?view=performance")}>Inspect performance →</Link></> : <div className="v2-calm-state compact"><strong>No clear bottleneck yet.</strong><p>Connect more performance data. Ensemblis will diagnose the weakest conversion step instead of asking you to post more by default.</p></div>}
            </article>
          </div>

          <section className="v2-section growth-polish-plan-preview">
            <div className="v2-section-heading"><div><span className="section-label">Portfolio plan</span><h2>What is already in motion</h2></div><Link href={href("/studio/calendar")}>Open calendar</Link></div>
            <div className="growth-queue">
              {scheduledReleases.slice(0, 3).map((release) => <Link href={href(`/studio/releases/${release.id}`)} className="growth-queue-item locked" key={`release-${release.id}`}><span className="growth-queue-date">{shortDate(release.release_date)}</span><div><small>Committed release</small><strong>{release.title}</strong><p>{release.status} · Ensemblis plans around this date.</p></div><b>Locked</b></Link>)}
              {plan.slice(0, 4).map((item) => {
                const track = item.track_vault_id ? vaultById.get(item.track_vault_id) : null;
                const release = item.release_id ? releaseById.get(item.release_id) : null;
                const target = track?.title || release?.title || "Portfolio item";
                return <div className="growth-queue-item" key={item.id}><span className="growth-queue-date">{shortDate(item.target_date)}</span><div><small>{item.status} · score {Math.round(Number(item.candidate_score))}</small><strong>{target}</strong><p>{item.rationale}</p></div>{track && !track.linked_release_id ? <form action={promoteVaultTrack}><input type="hidden" name="id" value={track.id} /><button className="button" type="submit">Use slot</button></form> : <span />}</div>;
              })}
              {!scheduledReleases.length && !plan.length ? <div className="v2-calm-state compact"><strong>No portfolio plan yet.</strong><p>Recalculate the plan. Existing scheduled releases stay fixed; Ensemblis fills only safe gaps.</p></div> : null}
            </div>
          </section>

          <section className="v2-section growth-polish-opportunity-preview">
            <div className="v2-section-heading"><div><span className="section-label">In motion</span><h2>{acceptedOpportunities.length ? `${acceptedOpportunities.length} active opportunit${acceptedOpportunities.length === 1 ? "y" : "ies"}` : "No activated opportunities"}</h2></div><Link href={href("/studio/growth?view=opportunities")}>All opportunities</Link></div>
            {acceptedOpportunities.length ? <div className="growth-polish-simple-list">{acceptedOpportunities.slice(0, 4).map((item) => <div key={item.id}><span>{titleCase(item.kind)}</span><strong>{item.title}</strong><small>{Math.round(Number(item.confidence) * 100)}% confidence</small></div>)}</div> : <div className="v2-calm-state compact"><strong>Nothing extra needs activation.</strong><p>Ensemblis will surface evidence-backed catalog or breakout opportunities when there is a reason to act.</p></div>}
          </section>
        </>
      ) : null}

      {view === "opportunities" ? (
        <section className="v2-section growth-polish-view-section" id="opportunities">
          <div className="v2-section-heading"><div><span className="section-label">Always-on growth</span><h2>Opportunities Ensemblis found</h2></div></div>
          {opportunities.length ? <div className="growth-opportunity-grid">{opportunities.map((opportunity) => <article className={`growth-opportunity ${opportunity.status === "accepted" ? "accepted" : ""}`} key={opportunity.id}><div className="growth-opportunity-head"><span>{titleCase(opportunity.kind)}</span><strong>{opportunity.priority}</strong></div><h3>{opportunity.title}</h3><p>{opportunity.rationale}</p><small>{Math.round(Number(opportunity.confidence) * 100)}% confidence · {opportunity.status}</small><div className="actions">{opportunity.status === "new" ? <form action={activateGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button primary" type="submit">Activate</button></form> : <span className="growth-active-label">In motion</span>}{opportunity.status === "new" ? <form action={dismissGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button" type="submit">Dismiss</button></form> : null}{opportunity.release_id ? <Link className="button" href={href(`/studio/releases/${opportunity.release_id}`)}>Open release</Link> : null}</div></article>)}</div> : <div className="v2-calm-state compact"><strong>No active opportunity alerts.</strong><p>Run a scan after performance data changes. Catalog revivals and breakout creative only appear when there is evidence.</p></div>}
        </section>
      ) : null}

      {view === "performance" ? (
        <section className="v2-section growth-polish-view-section" id="funnel">
          <div className="v2-section-heading"><div><span className="section-label">Audience funnel</span><h2>Where attention turns into fandom</h2></div><Link href={href("/studio/analytics")}>Full analytics</Link></div>
          <div className="growth-funnel"><article><span>Discovery</span><strong>{funnel.reach.toLocaleString()}</strong><small>qualified reach / views</small></article><i>→</i><article><span>Curiosity</span><strong>{funnel.profileVisits.toLocaleString()}</strong><small>{percent(funnel.profileVisitRate)} reach → profile</small></article><i>→</i><article><span>Music intent</span><strong>{funnel.linkClicks.toLocaleString()}</strong><small>{percent(funnel.linkClickRate)} profile → click</small></article><i>→</i><article><span>Listening</span><strong>{funnel.listeners.toLocaleString()}</strong><small>{funnel.streamsPerListener ? `${Math.round(funnel.streamsPerListener * 10) / 10} streams / listener` : "listener data needed"}</small></article><i>→</i><article><span>Fandom</span><strong>{(funnel.saves + funnel.follows + funnel.playlistAdds).toLocaleString()}</strong><small>{percent(funnel.saveRate)} save · {percent(funnel.followRate)} follow</small></article></div>
          {diagnosis ? <div className="growth-action-note growth-performance-diagnosis"><strong>Current constraint</strong><span>{diagnosis.diagnosis} {diagnosis.action}</span></div> : null}
        </section>
      ) : null}

      {view === "portfolio" ? (
        <>
          <section className="v2-section growth-polish-view-section" id="vault">
            <div className="v2-section-heading"><div><span className="section-label">Portfolio maintenance</span><h2>{vault.length} track{vault.length === 1 ? "" : "s"} in the source backlog</h2></div><Link href={href("/studio/music")}>Back to Music</Link></div>
            <p className="v2-muted-copy">This is the detailed signal editor behind Music. Use it when Ensemblis needs corrected readiness, ranking or hold information, not as the normal way to browse tracks.</p>
            {ranked.length ? <div className="growth-vault-list">{ranked.map((item, index) => <details className="growth-vault-track" key={item.track.id}><summary><span className="growth-rank">#{index + 1}</span><div><strong>{item.track.title}</strong><small>{titleCase(item.track.status)}{item.track.version ? ` · ${item.track.version}` : ""}{item.track.linked_release_id ? " · linked to release" : ""}</small></div><div className="growth-score-pill">{item.eligible ? Math.round(item.score) : "Hold"}</div></summary><div className="growth-vault-editor">{item.blocker ? <p className="notice">{item.blocker}</p> : <p className="v2-muted-copy">Ranking drivers: {item.reasons.join(" · ")}.</p>}<MusicIntelligencePreview audioUrl={item.track.audio_url} musicMap={item.track.audio_profile} /><form action={saveVaultTrack} className="growth-vault-form"><input type="hidden" name="id" value={item.track.id} /><label><span>Title</span><input name="title" defaultValue={item.track.title} required /></label><label><span>Version</span><input name="version" defaultValue={item.track.version ?? ""} /></label><label><span>Status</span><select name="status" defaultValue={item.track.status}>{["idea", "demo", "mix", "mastered", "release_candidate", "hold", "scheduled", "released"].map((status) => <option value={status} key={status}>{titleCase(status)}</option>)}</select></label><label><span>Your rating</span><input type="number" min="1" max="5" name="artist_rating" defaultValue={item.track.artist_rating ?? ""} /></label><label><span>Hook</span><input type="number" min="0" max="100" name="hook_strength" defaultValue={item.track.hook_strength} /></label><label><span>Short-form</span><input type="number" min="0" max="100" name="short_form_potential" defaultValue={item.track.short_form_potential} /></label><label><span>Uniqueness</span><input type="number" min="0" max="100" name="uniqueness_score" defaultValue={item.track.uniqueness_score} /></label><label><span>Readiness</span><input type="number" min="0" max="100" name="release_readiness" defaultValue={item.track.release_readiness} /></label><label><span>Visual</span><input type="number" min="0" max="100" name="visual_potential" defaultValue={item.track.visual_potential} /></label><label><span>Hook start (sec)</span><input type="number" min="0" name="hook_start_seconds" defaultValue={item.track.hook_start_seconds ?? ""} /></label><label><span>Hook end (sec)</span><input type="number" min="0" name="hook_end_seconds" defaultValue={item.track.hook_end_seconds ?? ""} /></label><label><span>Hold until</span><input type="date" name="hold_until" defaultValue={item.track.hold_until ?? ""} /></label><label className="wide"><span>Audio URL</span><input type="url" name="audio_url" defaultValue={item.track.audio_url ?? ""} /></label><label className="wide"><span>Notes</span><textarea name="notes" defaultValue={item.track.notes ?? ""} /></label><div className="actions wide"><button className="button primary" type="submit">Save signals</button>{!item.track.linked_release_id && item.eligible ? <button className="button" formAction={promoteVaultTrack} name="id" value={item.track.id}>Promote to release</button> : null}</div></form><form action={archiveVaultTrack}><input type="hidden" name="id" value={item.track.id} /><button className="text-button" type="submit">Archive from vault</button></form></div></details>)}</div> : <div className="v2-calm-state compact"><strong>The vault is empty.</strong><p>Add the backlog first. Ensemblis cannot manage a portfolio it cannot see.</p></div>}

            <details className="growth-add-track"><summary>+ Add unreleased track</summary><form action={saveVaultTrack} className="growth-vault-form"><label><span>Title</span><input name="title" required /></label><label><span>Version</span><input name="version" /></label><label><span>Status</span><select name="status" defaultValue="mastered"><option value="idea">Idea</option><option value="demo">Demo</option><option value="mix">Mix</option><option value="mastered">Mastered</option><option value="release_candidate">Release candidate</option><option value="hold">Hold</option></select></label><label><span>Your rating</span><input type="number" min="1" max="5" name="artist_rating" /></label><label><span>Hook</span><input type="number" min="0" max="100" name="hook_strength" defaultValue="50" /></label><label><span>Short-form</span><input type="number" min="0" max="100" name="short_form_potential" defaultValue="50" /></label><label><span>Uniqueness</span><input type="number" min="0" max="100" name="uniqueness_score" defaultValue="50" /></label><label><span>Readiness</span><input type="number" min="0" max="100" name="release_readiness" defaultValue="70" /></label><label><span>Visual</span><input type="number" min="0" max="100" name="visual_potential" defaultValue="50" /></label><label className="wide"><span>Audio URL</span><input type="url" name="audio_url" /></label><label className="wide"><span>Notes</span><textarea name="notes" placeholder="What makes this track special? Anything Ensemblis should know before choosing a release slot?" /></label><div className="wide"><button className="button primary" type="submit">Add to Vault</button></div></form></details>
          </section>

          <section className="v2-section growth-settings growth-polish-rules">
            <div className="v2-section-heading"><div><span className="section-label">Decision rules</span><h2>How aggressively should Ensemblis plan releases?</h2></div></div>
            <form action={saveGrowthSettings} className="growth-settings-form"><label><span>Planning horizon</span><input type="number" min="30" max="365" name="planning_horizon_days" defaultValue={settings.planning_horizon_days} /><small>days</small></label><label><span>Release cadence</span><input type="number" min="7" max="120" name="release_cadence_days" defaultValue={settings.release_cadence_days} /><small>days</small></label><label><span>Minimum candidate score</span><input type="number" min="0" max="100" name="minimum_candidate_score" defaultValue={settings.minimum_candidate_score} /><small>/100</small></label><label className="growth-toggle"><input type="checkbox" name="catalog_engine_enabled" defaultChecked={settings.catalog_engine_enabled} /><span>Always-on catalog opportunity detection</span></label><label className="growth-toggle"><input type="checkbox" name="autoplan_enabled" defaultChecked={settings.autoplan_enabled} /><span>Keep a decision-engine portfolio plan</span></label><button className="button primary" type="submit">Save growth rules</button></form>
          </section>
        </>
      ) : null}
    </div>
  );
}
