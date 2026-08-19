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
import { PageHeader } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { asGrowthClient } from "@/lib/studio/growth-db";
import {
  buildGrowthFunnel,
  diagnoseGrowthFunnel,
  rankVaultTracks,
} from "@/lib/studio/growth";
import type { GrowthSettings } from "@/types/growth-database";

const DEFAULT_SETTINGS: Pick<GrowthSettings, "north_star" | "planning_horizon_days" | "release_cadence_days" | "minimum_candidate_score" | "catalog_engine_enabled" | "autoplan_enabled"> = {
  north_star: "active_fanbase",
  planning_horizon_days: 90,
  release_cadence_days: 28,
  minimum_candidate_score: 55,
  catalog_engine_enabled: true,
  autoplan_enabled: true,
};

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

export default async function GrowthPage() {
  const { supabase, user } = await requireStudioAdmin();
  const growth = asGrowthClient(supabase);
  const [settingsResult, vaultResult, planResult, opportunityResult, releasesResult, metricsResult] = await Promise.all([
    growth.from("artist_growth_settings").select("*").eq("owner_id", user.id).maybeSingle(),
    growth.from("track_vault").select("*").eq("owner_id", user.id).neq("status", "archived").order("updated_at", { ascending: false }),
    growth.from("growth_plan_items").select("*").eq("owner_id", user.id).in("status", ["proposed","accepted","scheduled"]).order("target_date").order("sort_order"),
    growth.from("growth_opportunities").select("*").eq("owner_id", user.id).in("status", ["new","accepted"]).order("priority", { ascending: false }).order("detected_at", { ascending: false }),
    supabase.from("releases").select("id,title,status,release_date,artwork_url").eq("owner_id", user.id).order("release_date", { ascending: true }),
    supabase.from("metric_snapshots").select("*").eq("owner_id", user.id),
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
  const scheduledReleases = releases.filter((release) => release.release_date && release.release_date >= nowDate && ["Idea","In Progress","Scheduled"].includes(release.status));
  const acceptedOpportunities = opportunities.filter((item) => item.status === "accepted");

  return (
    <div className="studio-v2-page growth-os-page">
      <PageHeader
        title="Artist Growth OS"
        description="Manage the Atlas Irwin portfolio as one growth system: choose the right next track, keep a 90-day release queue, detect catalog opportunities, and fix the real audience bottleneck."
        action={
          <div className="actions">
            <form action={refreshGrowthOpportunities}><button className="button" type="submit">Scan opportunities</button></form>
            <form action={generateGrowthPlan}><button className="button primary" type="submit">Rebuild 90-day plan</button></form>
          </div>
        }
      />

      <section className="growth-north-star">
        <article className="growth-north-star-main">
          <span className="section-label">North star</span>
          <div className="growth-big-number">{funnel.fanSignalScore.toLocaleString()}</div>
          <h2>Active fan signal</h2>
          <p>A weighted proxy from saves, follows, playlist adds and repeat listening signals. It is deliberately not raw streams.</p>
        </article>
        <div className="growth-north-star-stats">
          <article><strong>{funnel.listeners.toLocaleString()}</strong><span>listeners</span></article>
          <article><strong>{funnel.saves.toLocaleString()}</strong><span>saves</span></article>
          <article><strong>{funnel.follows.toLocaleString()}</strong><span>follows</span></article>
          <article><strong>{funnel.playlistAdds.toLocaleString()}</strong><span>playlist adds</span></article>
        </div>
      </section>

      <section className="growth-command-grid">
        <article className="v2-section growth-recommendation">
          <div className="v2-section-heading"><div><span className="section-label">Release intelligence</span><h2>What should Atlas Irwin release next?</h2></div></div>
          {topCandidate ? (
            <>
              <div className="growth-candidate-score"><strong>{Math.round(topCandidate.score)}</strong><span>/100 portfolio score</span></div>
              <h3>{topCandidate.track.title}</h3>
              <p>{topCandidate.reasons.join(" · ")}</p>
              <div className="growth-chip-row">
                <span>{titleCase(topCandidate.track.status)}</span>
                <span>Hook {topCandidate.track.hook_strength}</span>
                <span>Short-form {topCandidate.track.short_form_potential}</span>
                <span>Unique {topCandidate.track.uniqueness_score}</span>
              </div>
              <div className="actions">
                <form action={promoteVaultTrack}><input type="hidden" name="id" value={topCandidate.track.id} /><button className="button primary" type="submit">Promote to release</button></form>
                <a className="button" href="#vault">Review vault</a>
              </div>
            </>
          ) : (
            <div className="v2-calm-state compact"><strong>No eligible unreleased candidate yet.</strong><p>Add mastered tracks to the Vault, then Atlas will rank them without spending an AI call.</p></div>
          )}
        </article>

        <article className="v2-section growth-bottleneck">
          <div className="v2-section-heading"><div><span className="section-label">Growth diagnosis</span><h2>{diagnosis ? diagnosis.label : "Need more signal"}</h2></div></div>
          {diagnosis ? (
            <>
              <div className="growth-rate-compare"><div><strong>{percent(diagnosis.actual)}</strong><span>current</span></div><div><strong>{percent(diagnosis.target)}</strong><span>working target</span></div></div>
              <p>{diagnosis.diagnosis}</p>
              <div className="growth-action-note"><strong>Do next</strong><span>{diagnosis.action}</span></div>
            </>
          ) : (
            <div className="v2-calm-state compact"><strong>No clear bottleneck yet.</strong><p>Connect more performance data. Atlas will diagnose the weakest conversion step instead of asking you to post more by default.</p></div>
          )}
        </article>
      </section>

      <section className="v2-section" id="queue">
        <div className="v2-section-heading"><div><span className="section-label">Portfolio queue</span><h2>Next {settings.planning_horizon_days} days</h2></div><form action={generateGrowthPlan}><button className="text-button" type="submit">Recalculate</button></form></div>
        <div className="growth-queue">
          {scheduledReleases.map((release) => (
            <Link href={`/studio/releases/${release.id}`} className="growth-queue-item locked" key={`release-${release.id}`}>
              <span className="growth-queue-date">{shortDate(release.release_date)}</span>
              <div><small>Committed release</small><strong>{release.title}</strong><p>{release.status} · Atlas plans around this date.</p></div>
              <b>Locked</b>
            </Link>
          ))}
          {plan.map((item) => {
            const track = item.track_vault_id ? vaultById.get(item.track_vault_id) : null;
            const release = item.release_id ? releaseById.get(item.release_id) : null;
            const target = track?.title || release?.title || "Portfolio item";
            return (
              <div className="growth-queue-item" key={item.id}>
                <span className="growth-queue-date">{shortDate(item.target_date)}</span>
                <div><small>{item.status} · score {Math.round(Number(item.candidate_score))}</small><strong>{target}</strong><p>{item.rationale}</p></div>
                {track && !track.linked_release_id ? <form action={promoteVaultTrack}><input type="hidden" name="id" value={track.id} /><button className="button" type="submit">Use this slot</button></form> : <span />}
              </div>
            );
          })}
          {!scheduledReleases.length && !plan.length ? <div className="v2-calm-state compact"><strong>No portfolio plan yet.</strong><p>Rebuild the 90-day plan. Existing scheduled releases stay fixed; Atlas fills only safe gaps.</p></div> : null}
        </div>
      </section>

      <section className="v2-section" id="opportunities">
        <div className="v2-section-heading"><div><span className="section-label">Always-on growth</span><h2>Opportunities Atlas found</h2></div><form action={refreshGrowthOpportunities}><button className="text-button" type="submit">Scan now</button></form></div>
        {opportunities.length ? <div className="growth-opportunity-grid">{opportunities.map((opportunity) => (
          <article className={`growth-opportunity ${opportunity.status === "accepted" ? "accepted" : ""}`} key={opportunity.id}>
            <div className="growth-opportunity-head"><span>{titleCase(opportunity.kind)}</span><strong>{opportunity.priority}</strong></div>
            <h3>{opportunity.title}</h3>
            <p>{opportunity.rationale}</p>
            <small>{Math.round(Number(opportunity.confidence) * 100)}% confidence · {opportunity.status}</small>
            <div className="actions">
              {opportunity.status === "new" ? <form action={activateGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button primary" type="submit">Activate</button></form> : <span className="growth-active-label">In motion</span>}
              {opportunity.status === "new" ? <form action={dismissGrowthOpportunity}><input type="hidden" name="id" value={opportunity.id} /><button className="button" type="submit">Dismiss</button></form> : null}
              {opportunity.release_id ? <Link className="button" href={`/studio/releases/${opportunity.release_id}`}>Open release</Link> : null}
            </div>
          </article>
        ))}</div> : <div className="v2-calm-state compact"><strong>No active opportunity alerts.</strong><p>Run a scan after performance data changes. Catalog revivals and breakout creative only appear when there is evidence.</p></div>}
        {acceptedOpportunities.length ? <p className="v2-muted-copy growth-footnote">{acceptedOpportunities.length} opportunity{acceptedOpportunities.length === 1 ? " is" : "ies are"} currently in motion. Accepted catalog opportunities create a seven-day campaign only for connected social channels.</p> : null}
      </section>

      <section className="v2-section" id="funnel">
        <div className="v2-section-heading"><div><span className="section-label">Audience funnel</span><h2>Where attention turns into fandom</h2></div><Link href="/studio/analytics">Full analytics</Link></div>
        <div className="growth-funnel">
          <article><span>Discovery</span><strong>{funnel.reach.toLocaleString()}</strong><small>qualified reach / views</small></article>
          <i>→</i>
          <article><span>Curiosity</span><strong>{funnel.profileVisits.toLocaleString()}</strong><small>{percent(funnel.profileVisitRate)} reach → profile</small></article>
          <i>→</i>
          <article><span>Music intent</span><strong>{funnel.linkClicks.toLocaleString()}</strong><small>{percent(funnel.linkClickRate)} profile → click</small></article>
          <i>→</i>
          <article><span>Listening</span><strong>{funnel.listeners.toLocaleString()}</strong><small>{funnel.streamsPerListener ? `${Math.round(funnel.streamsPerListener * 10) / 10} streams / listener` : "listener data needed"}</small></article>
          <i>→</i>
          <article><span>Fandom</span><strong>{(funnel.saves + funnel.follows + funnel.playlistAdds).toLocaleString()}</strong><small>{percent(funnel.saveRate)} save · {percent(funnel.followRate)} follow</small></article>
        </div>
      </section>

      <section className="v2-section" id="vault">
        <div className="v2-section-heading"><div><span className="section-label">Unreleased Vault</span><h2>{vault.length} track{vault.length === 1 ? "" : "s"} waiting for a decision</h2></div></div>
        {ranked.length ? <div className="growth-vault-list">{ranked.map((item, index) => (
          <details className="growth-vault-track" key={item.track.id}>
            <summary>
              <span className="growth-rank">#{index + 1}</span>
              <div><strong>{item.track.title}</strong><small>{titleCase(item.track.status)}{item.track.version ? ` · ${item.track.version}` : ""}{item.track.linked_release_id ? " · linked to release" : ""}</small></div>
              <div className="growth-score-pill">{item.eligible ? Math.round(item.score) : "Hold"}</div>
            </summary>
            <div className="growth-vault-editor">
              {item.blocker ? <p className="notice">{item.blocker}</p> : <p className="v2-muted-copy">Ranking drivers: {item.reasons.join(" · ")}.</p>}
              <form action={saveVaultTrack} className="growth-vault-form">
                <input type="hidden" name="id" value={item.track.id} />
                <label><span>Title</span><input name="title" defaultValue={item.track.title} required /></label>
                <label><span>Version</span><input name="version" defaultValue={item.track.version ?? ""} /></label>
                <label><span>Status</span><select name="status" defaultValue={item.track.status}>{["idea","demo","mix","mastered","release_candidate","hold","scheduled","released"].map((status) => <option value={status} key={status}>{titleCase(status)}</option>)}</select></label>
                <label><span>Your rating</span><input type="number" min="1" max="5" name="artist_rating" defaultValue={item.track.artist_rating ?? ""} /></label>
                <label><span>Hook</span><input type="number" min="0" max="100" name="hook_strength" defaultValue={item.track.hook_strength} /></label>
                <label><span>Short-form</span><input type="number" min="0" max="100" name="short_form_potential" defaultValue={item.track.short_form_potential} /></label>
                <label><span>Uniqueness</span><input type="number" min="0" max="100" name="uniqueness_score" defaultValue={item.track.uniqueness_score} /></label>
                <label><span>Readiness</span><input type="number" min="0" max="100" name="release_readiness" defaultValue={item.track.release_readiness} /></label>
                <label><span>Visual</span><input type="number" min="0" max="100" name="visual_potential" defaultValue={item.track.visual_potential} /></label>
                <label><span>Hook start (sec)</span><input type="number" min="0" name="hook_start_seconds" defaultValue={item.track.hook_start_seconds ?? ""} /></label>
                <label><span>Hook end (sec)</span><input type="number" min="0" name="hook_end_seconds" defaultValue={item.track.hook_end_seconds ?? ""} /></label>
                <label><span>Hold until</span><input type="date" name="hold_until" defaultValue={item.track.hold_until ?? ""} /></label>
                <label className="wide"><span>Audio URL</span><input type="url" name="audio_url" defaultValue={item.track.audio_url ?? ""} /></label>
                <label className="wide"><span>Notes</span><textarea name="notes" defaultValue={item.track.notes ?? ""} /></label>
                <div className="actions wide"><button className="button primary" type="submit">Save signals</button>{!item.track.linked_release_id && item.eligible ? <button className="button" formAction={promoteVaultTrack} name="id" value={item.track.id}>Promote to release</button> : null}</div>
              </form>
              <form action={archiveVaultTrack}><input type="hidden" name="id" value={item.track.id} /><button className="text-button" type="submit">Archive from vault</button></form>
            </div>
          </details>
        ))}</div> : <div className="v2-calm-state compact"><strong>The vault is empty.</strong><p>Add the backlog first. Atlas cannot manage a portfolio it cannot see.</p></div>}

        <details className="growth-add-track">
          <summary>+ Add unreleased track</summary>
          <form action={saveVaultTrack} className="growth-vault-form">
            <label><span>Title</span><input name="title" required /></label>
            <label><span>Version</span><input name="version" /></label>
            <label><span>Status</span><select name="status" defaultValue="mastered"><option value="idea">Idea</option><option value="demo">Demo</option><option value="mix">Mix</option><option value="mastered">Mastered</option><option value="release_candidate">Release candidate</option><option value="hold">Hold</option></select></label>
            <label><span>Your rating</span><input type="number" min="1" max="5" name="artist_rating" /></label>
            <label><span>Hook</span><input type="number" min="0" max="100" name="hook_strength" defaultValue="50" /></label>
            <label><span>Short-form</span><input type="number" min="0" max="100" name="short_form_potential" defaultValue="50" /></label>
            <label><span>Uniqueness</span><input type="number" min="0" max="100" name="uniqueness_score" defaultValue="50" /></label>
            <label><span>Readiness</span><input type="number" min="0" max="100" name="release_readiness" defaultValue="70" /></label>
            <label><span>Visual</span><input type="number" min="0" max="100" name="visual_potential" defaultValue="50" /></label>
            <label className="wide"><span>Audio URL</span><input type="url" name="audio_url" /></label>
            <label className="wide"><span>Notes</span><textarea name="notes" placeholder="What makes this track special? Anything Atlas should know before choosing a release slot?" /></label>
            <div className="wide"><button className="button primary" type="submit">Add to Vault</button></div>
          </form>
        </details>
      </section>

      <section className="v2-section growth-settings">
        <div className="v2-section-heading"><div><span className="section-label">Decision rules</span><h2>Teach Atlas how aggressively to release</h2></div></div>
        <form action={saveGrowthSettings} className="growth-settings-form">
          <label><span>Planning horizon</span><input type="number" min="30" max="365" name="planning_horizon_days" defaultValue={settings.planning_horizon_days} /><small>days</small></label>
          <label><span>Release cadence</span><input type="number" min="7" max="120" name="release_cadence_days" defaultValue={settings.release_cadence_days} /><small>days</small></label>
          <label><span>Minimum candidate score</span><input type="number" min="0" max="100" name="minimum_candidate_score" defaultValue={settings.minimum_candidate_score} /><small>/100</small></label>
          <label className="growth-toggle"><input type="checkbox" name="catalog_engine_enabled" defaultChecked={settings.catalog_engine_enabled} /><span>Always-on catalog opportunity detection</span></label>
          <label className="growth-toggle"><input type="checkbox" name="autoplan_enabled" defaultChecked={settings.autoplan_enabled} /><span>Keep a decision-engine portfolio plan</span></label>
          <button className="button primary" type="submit">Save growth rules</button>
        </form>
      </section>
    </div>
  );
}
