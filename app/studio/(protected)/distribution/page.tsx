import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { distributionProviderConfigured } from "@/lib/distribution/provider";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { saveDistributionAccount } from "@/app/studio/distribution-actions-safe";
import type { DistributionDatabase } from "@/types/distribution-database";

export const metadata = { title: "Distribution" };

function stateLabel(state: string) {
  return state.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default async function DistributionHub({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const feedback = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as SupabaseClient<DistributionDatabase>;
  const [accountResult, releasesResult, configsResult, issuesResult, deliveriesResult] = await Promise.all([
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").maybeSingle(),
    db.from("releases").select("id,title,artist,release_type,release_date,artwork_url,cover_asset,status,is_archived").eq("owner_id", user.id).eq("artist_id", artist.artistId).eq("is_archived", false).order("release_date", { ascending: false, nullsFirst: false }),
    db.from("release_distribution_configs").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_validation_issues").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["open", "acknowledged"]).order("severity").limit(12),
    db.from("distribution_deliveries").select("release_id,state,store_id").eq("owner_id", user.id).eq("artist_id", artist.artistId),
  ]);
  for (const result of [accountResult, releasesResult, configsResult, issuesResult, deliveriesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const account = accountResult.data;
  const releases = releasesResult.data ?? [];
  const configs = configsResult.data ?? [];
  const issues = issuesResult.data ?? [];
  const deliveries = deliveriesResult.data ?? [];
  const configByRelease = new Map(configs.map((config) => [config.release_id, config]));
  const deliveryByRelease = new Map<string, typeof deliveries>();
  for (const delivery of deliveries) deliveryByRelease.set(delivery.release_id, [...(deliveryByRelease.get(delivery.release_id) ?? []), delivery]);

  const activeConfigs = configs.filter((config) => !["draft", "needs_attention", "ready"].includes(config.state));
  const liveCount = configs.filter((config) => config.state === "live").length;
  const inFlightCount = configs.filter((config) => ["submitted", "under_review", "approved", "delivering", "delivered", "partially_live"].includes(config.state)).length;
  const needsAttentionCount = configs.filter((config) => ["needs_attention", "rejected", "error"].includes(config.state)).length;
  const providerConfigured = distributionProviderConfigured();

  return <div className="distribution-page distribution-hub">
    <header className="distribution-header">
      <div><span className="section-label">Ensemblis Distribution · {artist.artistName}</span><h1>Distribution</h1><p>One control plane for release readiness, DSP delivery, catalog health and store-level issues.</p></div>
      <div className="actions"><Link className="button" href="/studio/distribution/operations">Operations</Link></div>
    </header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Done</strong><span>{feedback.notice}</span></div> : null}

    <div className="distribution-stat-grid">
      <article><strong>{liveCount}</strong><span>Live releases</span><small>Confirmed on-store state where available</small></article>
      <article><strong>{inFlightCount}</strong><span>In distribution</span><small>Review, delivery or partial-live state</small></article>
      <article><strong>{needsAttentionCount}</strong><span>Need attention</span><small>Release-level workflow state</small></article>
      <article><strong>{issues.length}</strong><span>Open findings</span><small>Current validation/provider issues</small></article>
    </div>

    <section className="distribution-section" id="onboarding">
      <div className="distribution-section-heading"><div><span className="section-label">Distribution account</span><h2>{account ? "Distribution identity" : "Complete one-time onboarding"}</h2><p>Account-level identity and terms are confirmed once. Rights and AI declarations are still release-specific.</p></div><span className={`distribution-state ${account?.status === "active" ? "state-live" : "state-under_review"}`}>{account ? stateLabel(account.status) : "Setup required"}</span></div>
      {account ? <div className="distribution-account-summary"><dl><div><dt>Legal name</dt><dd>{account.legal_name}</dd></div><div><dt>Country</dt><dd>{account.country_code}</dd></div><div><dt>Identity verification</dt><dd>{stateLabel(account.kyc_status)}</dd></div><div><dt>Payout setup</dt><dd>{stateLabel(account.payout_status)}</dd></div><div><dt>Provider connection</dt><dd>{providerConfigured ? "Server connected" : "Credentials required"}</dd></div></dl><p>Verification and payout statuses are provider-controlled. Ensemblis never marks them complete without provider evidence.</p></div> : <form action={saveDistributionAccount} className="distribution-onboarding-form"><div className="distribution-field-grid"><label>Legal person or business name<input name="legal_name" required autoComplete="name" /></label><label>Country code<input name="country_code" required minLength={2} maxLength={2} placeholder="DE" /></label></div><div className="distribution-checkboxes"><label><input type="checkbox" name="agreement_accepted" required />I accept the Ensemblis distribution agreement and understand that releases are subject to DSP/provider review.</label><label><input type="checkbox" name="rights_terms_accepted" required />I understand that I must hold and accurately declare the rights required for every release I distribute.</label></div><button className="button primary" type="submit">Start distribution setup</button></form>}
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Catalog</span><h2>{releases.length} release{releases.length === 1 ? "" : "s"}</h2><p>Distribution is part of {artist.artistName}&apos;s canonical Ensemblis catalog, never a duplicate catalog.</p></div></div>
      <div className="distribution-release-list">
        {releases.map((release) => {
          const config = configByRelease.get(release.id);
          const releaseDeliveries = deliveryByRelease.get(release.id) ?? [];
          const liveStores = releaseDeliveries.filter((delivery) => delivery.state === "live").length;
          const state = config?.state ?? "draft";
          return <Link href={`/studio/releases/${release.id}/distribution`} key={release.id} className="distribution-release-row"><div className="distribution-release-artwork">{release.artwork_url ? <img src={release.artwork_url} alt="" /> : <span>{release.title.slice(0, 1).toUpperCase()}</span>}</div><div className="distribution-release-copy"><strong>{release.title}</strong><span>{release.artist} · {release.release_type}</span><small>{release.release_date ?? "Release date not set"}</small></div><div className="distribution-release-progress"><span className={`distribution-state state-${state}`}>{stateLabel(state)}</span><small>{releaseDeliveries.length ? `${liveStores}/${releaseDeliveries.length} services confirmed live` : config ? `${config.readiness_score}% readiness` : "Not prepared yet"}</small></div><b aria-hidden>→</b></Link>;
        })}
      </div>
    </section>

    {issues.length ? <section className="distribution-section distribution-issues"><div className="distribution-section-heading"><div><span className="section-label">Portfolio attention</span><h2>Open distribution findings</h2></div></div><div className="distribution-issue-list">{issues.map((issue) => { const release = releases.find((item) => item.id === issue.release_id); return <Link href={`/studio/releases/${issue.release_id}/distribution`} className={`issue-${issue.severity}`} key={issue.id}><span>{issue.severity}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p><small>{release?.title ?? "Release"}</small></div></Link>; })}</div></section> : null}

    {!activeConfigs.length && account ? <section className="distribution-section distribution-callout"><div><span className="section-label">Get started</span><h2>Your distribution account is ready for release preparation</h2><p>Open any release and use Music Distribution to confirm rights, AI provenance, artist profiles and provider preflight.</p></div><Link className="button primary" href="/studio/releases">Choose a release</Link></section> : null}
  </div>;
}
