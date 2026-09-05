import Link from "next/link";
import {
  approvePaidGrowthExperiment,
  createPaidGrowthExperiment,
  evaluatePaidGrowthExperimentAction,
  launchPaidGrowthExperiment,
  recordPaidGrowthProviderSnapshot,
  stopPaidGrowthExperiment,
  syncPaidGrowthFirstPartyEvidence,
  syncPaidGrowthProvider,
} from "@/app/studio/paid-growth-actions";
import { PageHeader, Status } from "@/components/studio/ui";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { loadArtistMemoryForConsumer } from "@/lib/artist-memory/server";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { asMarketingClient } from "@/lib/marketing/db";
import { asPaidGrowthClient } from "@/lib/paid-growth/db";
import { paidGrowthEvidenceSummary } from "@/lib/paid-growth/server";
import { loadPaidGrowthWorkspace } from "@/lib/paid-growth/server";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";

export const metadata = { title: "Paid experiments" };

function money(cents: number) {
  return new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
}

function metricValue(card: Awaited<ReturnType<typeof loadPaidGrowthWorkspace>>["cards"][number]) {
  const value = card.evaluation.metricValue;
  if (value == null) return "Not enough evidence";
  if (card.experiment.success_metric.startsWith("cost_per_")) return money(Math.round(value));
  return Math.round(value * 100) / 100;
}

function human(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function PaidGrowthPage({ searchParams }: { searchParams: Promise<{ experiment?: string; notice?: string }> }) {
  const params = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const paid = asPaidGrowthClient(supabase);
  const marketing = asMarketingClient(supabase);
  const [workspace, growthMemory, releasesResult, momentsResult, contentResult, smartLinksResult] = await Promise.all([
    loadPaidGrowthWorkspace({ db: supabase, ownerId: user.id, artistId: artist.artistId }),
    loadArtistMemoryForConsumer({ db: supabase, ownerId: user.id, artistId: artist.artistId, consumer: "growth" }),
    paid.from("releases").select("id,title,status,release_date").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("updated_at", { ascending: false }),
    paid.from("moments").select("id,release_id,label,state").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("state", "approved").order("created_at", { ascending: false }),
    marketing.from("content_items").select("id,title,release_id,platform,asset_url,status").eq("owner_id", user.id).eq("artist_id", artist.artistId).not("asset_url", "is", null).order("updated_at", { ascending: false }).limit(100),
    paid.from("smart_links").select("id,release_id,is_active").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("is_active", true),
  ]);
  const firstError = [releasesResult, momentsResult, contentResult, smartLinksResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const releases = releasesResult.data ?? [];
  const releaseById = new Map(releases.map((release) => [release.id, release.title]));
  const smartLinkReleaseIds = new Set((smartLinksResult.data ?? []).map((link) => link.release_id));
  const eligibleReleases = releases.filter((release) => smartLinkReleaseIds.has(release.id));
  const moments = momentsResult.data ?? [];
  const content = contentResult.data ?? [];
  const selected = params.experiment ? workspace.cards.find((card) => card.experiment.id === params.experiment) ?? null : null;

  return <div className="studio-v2-page paid-growth-page">
    <PageHeader
      title="Paid experiments"
      description={`Use small, bounded tests to learn what actually moves ${artist.artistName}'s listeners. Every test has a hypothesis, first-party destination, hard spend ceiling and stop condition.`}
      action={<div className="actions"><Link className="button" href={href("/studio/growth")}>Back to Grow</Link><Link className="button" href={href("/studio/settings/autonomy")}>Paid autonomy</Link></div>}
    />

    {params.notice ? <div className="paid-growth-notice" role="status">{params.notice}</div> : null}

    <section className="paid-growth-summary" aria-label="Paid experiment summary">
      <div><strong>{workspace.activeCount}</strong><span>active or approved tests</span></div>
      <div><strong>{workspace.cards.length}</strong><span>tests recorded</span></div>
      <div><strong>{workspace.verifiedLearningCount}</strong><span>verified outcomes ready for learning</span></div>
      <p>Ensemblis does not optimize toward provider clicks alone. Owned Smart Link outcomes remain the canonical conversion evidence.</p>
    </section>

    <section className="v2-section paid-growth-create">
      <div className="v2-section-heading"><div><span className="section-label">Prepare one bounded test</span><h2>What do you believe is worth paying to learn?</h2><p>Preparing this does not spend money or launch an ad.</p></div></div>
      {growthMemory.items.length ? <div className="studio-smart-defaults" role="note">
        <strong>Artist Memory can support the hypothesis, not authorize the spend.</strong>
        <span>{growthMemory.items.length} qualifying evidence-backed signal{growthMemory.items.length === 1 ? " is" : "s are"} available. Maximum effect: rank opportunities only.</span>
        <details><summary>Review supporting memory</summary><ul>{growthMemory.items.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.value}</span></li>)}</ul></details>
      </div> : null}
      <form action={createPaidGrowthExperiment} className="paid-growth-form">
        <div className="paid-growth-field-grid">
          <label>Test name<input name="title" required minLength={3} maxLength={160} placeholder="Chorus discovery test" /></label>
          <label>Release<select name="release_id" required defaultValue=""><option value="" disabled>Choose release</option>{eligibleReleases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</select><small>Only releases with an active owned Smart Link are eligible.</small></label>
          <label>Approved creative<select name="content_item_id" required defaultValue=""><option value="" disabled>Choose finished creative</option>{content.map((item) => <option key={item.id} value={item.id}>{releaseById.get(item.release_id ?? "") ?? "Release"} · {item.title}</option>)}</select></label>
          <label>Musical Moment<select name="moment_id" defaultValue=""><option value="">No specific Moment</option>{moments.map((moment) => <option key={moment.id} value={moment.id}>{releaseById.get(moment.release_id) ?? "Release"} · {moment.label}</option>)}</select></label>
        </div>
        <label>Hypothesis<textarea name="hypothesis" required minLength={10} maxLength={2000} rows={3} placeholder="If we lead with the approved chorus Moment, cold listeners will click through to the song at a meaningful rate." /></label>
        <label>Why this is worth testing<textarea name="evidence_note" required minLength={10} maxLength={1200} rows={2} placeholder="The same Moment is repeatedly one of the strongest organic starting points, and the creative already has a clear release destination." /></label>

        <div className="paid-growth-field-grid">
          <label>Channel<select name="platform" defaultValue="instagram"><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select></label>
          <label>Objective<select name="objective" defaultValue="streams"><option value="streams">Drive listening intent</option><option value="pre_save">Pre-save</option><option value="traffic">Owned traffic</option><option value="discovery">Discovery</option></select></label>
          <label>Audience description<input name="audience_description" placeholder="Broad nu-disco / dance listeners" /></label>
          <label>Countries<input name="geo_countries" placeholder="DE, NL, FR" /><small>Blank means no Ensemblis geo restriction. Use ISO two-letter codes.</small></label>
        </div>

        <div className="paid-growth-contract">
          <div><span className="section-label">Spend contract</span><h3>The provider may never cross this ceiling</h3></div>
          <div className="paid-growth-field-grid">
            <label>Hard ceiling, USD<input name="budget_ceiling_usd" type="number" min="1" step="0.01" required placeholder="50" /></label>
            <label>Daily budget, USD<input name="daily_budget_usd" type="number" min="1" step="0.01" placeholder="10" /></label>
            <label>Minimum evidence sample<input name="minimum_sample" type="number" min="10" step="1" defaultValue="100" required /></label>
            <label>Success metric<select name="success_metric" defaultValue="outbound_clicks"><option value="outbound_clicks">Owned outbound clicks</option><option value="landing_views">Owned landing views</option><option value="pre_save_completions">Verified pre-saves</option><option value="cost_per_outbound_click">Cost per outbound click</option><option value="cost_per_pre_save_completion">Cost per verified pre-save</option></select></label>
            <label>Success threshold<input name="success_threshold" type="number" min="0.01" step="0.01" required defaultValue="20" /><small>For cost metrics this is USD; otherwise it is a count.</small></label>
            <label>Stop if this USD spend gets zero results<input name="max_spend_without_result_usd" type="number" min="0.01" step="0.01" placeholder="Defaults to half the hard ceiling" /></label>
            <label>Stop above this cost per result, USD<input name="max_cost_per_result_usd" type="number" min="0.01" step="0.01" placeholder="Optional" /></label>
          </div>
        </div>
        <div className="actions"><button className="button primary" type="submit">Prepare paid test</button><span className="v2-muted-copy">No spend occurs until the experiment is explicitly approved and a real paid-media provider is connected.</span></div>
      </form>
    </section>

    <section className="v2-section">
      <div className="v2-section-heading"><div><span className="section-label">Experiment memory</span><h2>{workspace.cards.length ? `${workspace.cards.length} bounded test${workspace.cards.length === 1 ? "" : "s"}` : "No paid tests yet"}</h2></div></div>
      {workspace.cards.length ? <div className="paid-growth-list">{workspace.cards.map((card) => {
        const experiment = card.experiment;
        const isSelected = selected?.experiment.id === experiment.id;
        return <article className={`paid-growth-card${isSelected ? " selected" : ""}`} id={`paid-${experiment.id}`} key={experiment.id}>
          <header><div><small>{card.releaseTitle} · {human(experiment.platform)} · {human(experiment.objective)}</small><h3>{experiment.title}</h3></div><Status>{human(experiment.state)}</Status></header>
          <p className="paid-growth-hypothesis">{experiment.hypothesis}</p>
          <div className="paid-growth-evidence-row"><span>{paidGrowthEvidenceSummary(experiment)}</span>{card.momentLabel ? <span>Moment: {card.momentLabel}</span> : null}{card.creativeTitle ? <span>Creative: {card.creativeTitle}</span> : null}</div>
          <div className="paid-growth-contract-grid">
            <div><span>Spend</span><strong>{card.spendLabel}</strong></div>
            <div><span>Success</span><strong>{card.successLabel}</strong></div>
            <div><span>Evidence</span><strong>{card.evaluation.label}</strong><small>{card.evaluation.detail}</small></div>
            <div><span>Current result</span><strong>{metricValue(card)}</strong><small>{card.evaluation.verified ? "Verified evidence" : "Not yet verified for learning"}</small></div>
          </div>

          {experiment.state === "ready_for_approval" && experiment.approval_status === "pending" ? <form action={approvePaidGrowthExperiment} className="paid-growth-approval"><input type="hidden" name="experiment_id" value={experiment.id} /><label className="inline-check"><input type="checkbox" name="confirm_approval" required />I reviewed the hypothesis, creative, destination, hard budget and stop condition.</label><button className="button primary" type="submit">Approve this paid test</button></form> : null}

          {experiment.state === "approved" && !card.providerConfigured ? <div className="paid-growth-provider-state"><strong>Provider connection required for launch</strong><p>{card.providerMessage}</p><div className="actions"><button className="button" disabled>Launch unavailable</button><form action={stopPaidGrowthExperiment}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="text-button" type="submit">Close experiment without launch</button></form></div></div> : null}
          {experiment.state === "approved" && card.providerConfigured ? <form action={launchPaidGrowthExperiment}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="button primary" type="submit">Launch approved test</button></form> : null}

          <div className="actions paid-growth-evidence-actions">
            <form action={syncPaidGrowthFirstPartyEvidence}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="button" type="submit">Refresh owned outcomes</button></form>
            <form action={evaluatePaidGrowthExperimentAction}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="button" type="submit">Evaluate now</button></form>
            {experiment.provider_experiment_id && card.providerConfigured ? <form action={syncPaidGrowthProvider}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="button" type="submit">Sync provider</button></form> : null}
            {["running", "paused", "evaluating"].includes(experiment.state) || (experiment.state === "approved" && experiment.approval_status === "approved") ? <form action={stopPaidGrowthExperiment}><input type="hidden" name="experiment_id" value={experiment.id} /><button className="button" type="submit">Stop test</button></form> : null}
          </div>

          <details className="paid-growth-advanced"><summary>Advanced evidence import</summary><p>Use this only to record cumulative provider numbers while no trusted API adapter is connected. Manual provider data remains unverified and cannot create durable learning by itself.</p><form action={recordPaidGrowthProviderSnapshot} className="paid-growth-field-grid"><input type="hidden" name="experiment_id" value={experiment.id} /><label>Provider impressions<input name="impressions" type="number" min="0" step="1" defaultValue="0" /></label><label>Provider clicks<input name="provider_clicks" type="number" min="0" step="1" defaultValue="0" /></label><label>Cumulative spend, USD<input name="spend_usd" type="number" min="0" step="0.01" defaultValue={(experiment.spent_cents / 100).toFixed(2)} /></label><label>Evidence note<input name="provider_note" placeholder="Copied from provider report" /></label><button className="button" type="submit">Record unverified snapshot</button></form></details>
        </article>;
      })}</div> : <div className="v2-calm-state compact"><strong>No reason to spend yet.</strong><p>Create a paid test only when you can state what you expect to learn and what evidence will stop the spend.</p></div>}
    </section>
  </div>;
}
