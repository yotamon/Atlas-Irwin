import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  calculateDistributionReadiness,
  normalizeAiProvenance,
  type DistributionIssue,
  type DistributionRights,
} from "@/lib/distribution/domain";
import { distributionProviderConfigured, getDistributionProvider, type ProviderStore } from "@/lib/distribution/provider";
import {
  runDistributionPreflight,
  saveDistributionArtistProfile,
  saveDistributionDeclarations,
  submitDistribution,
  syncDistributionStatus,
} from "@/app/studio/distribution-actions-safe";
import type { Json } from "@/types/database";

export const metadata = { title: "Music Distribution" };

type Db = any;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rightsFrom(value: Json | null | undefined): DistributionRights {
  const raw = object(value);
  const ugc = object(raw.ugc);
  return {
    masterRightsConfirmed: raw.masterRightsConfirmed === true,
    compositionRightsConfirmed: raw.compositionRightsConfirmed === true,
    samplesCleared: raw.samplesCleared === true,
    contributorPermissionsConfirmed: raw.contributorPermissionsConfirmed === true,
    aiDeclarationConfirmed: raw.aiDeclarationConfirmed === true,
    territories: raw.territories === "worldwide" || Array.isArray(raw.territories) ? raw.territories as "worldwide" | string[] : "worldwide",
    ugc: {
      enabled: ugc.enabled === true,
      exclusiveMasterConfirmed: ugc.exclusiveMasterConfirmed === true,
      noUnlicensedSamplesConfirmed: ugc.noUnlicensedSamplesConfirmed === true,
      noNonExclusiveBeatsConfirmed: ugc.noNonExclusiveBeatsConfirmed === true,
      noUnauthorizedVoicesConfirmed: ugc.noUnauthorizedVoicesConfirmed === true,
    },
  };
}

function destinationFrom(value: Json | null | undefined) {
  const raw = object(value);
  return {
    mode: raw.mode === "custom" ? "custom" : "all_enabled",
    storeIds: Array.isArray(raw.storeIds) ? raw.storeIds.map(Number).filter(Number.isFinite) : [],
  };
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function stateLabel(state: string) {
  const labels: Record<string, string> = {
    draft: "Draft",
    needs_attention: "Needs attention",
    ready: "Ready",
    submitted: "Submitted",
    under_review: "Under review",
    approved: "Approved",
    delivering: "Delivering",
    delivered: "Delivered",
    partially_live: "Partially live",
    live: "Live",
    rejected: "Needs correction",
    update_pending: "Update pending",
    takedown_pending: "Takedown pending",
    taken_down: "Taken down",
    error: "Provider error",
  };
  return labels[state] ?? titleCase(state);
}

export default async function ReleaseDistributionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const db = supabase as Db;
  const [releaseResult, tracksResult, configResult, accountResult, profilesResult, issuesResult, deliveriesResult, submissionsResult] = await Promise.all([
    supabase.from("releases").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle(),
    supabase.from("tracks").select("*").eq("release_id", id).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", id).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").maybeSingle(),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id),
    db.from("distribution_validation_issues").select("*").eq("release_id", id).eq("owner_id", user.id).in("status", ["open", "acknowledged"]).order("severity"),
    db.from("distribution_deliveries").select("*").eq("release_id", id).eq("owner_id", user.id).order("store_name"),
    db.from("distribution_submissions").select("id,version,submitted_at,provider,provider_release_id").eq("release_id", id).eq("owner_id", user.id).order("version", { ascending: false }).limit(5),
  ]);
  if (!releaseResult.data) notFound();
  for (const result of [tracksResult, configResult, accountResult, profilesResult, issuesResult, deliveriesResult, submissionsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const release = releaseResult.data;
  const tracks = tracksResult.data ?? [];
  const config = configResult.data;
  const account = accountResult.data;
  const profiles = profilesResult.data ?? [];
  const persistedIssues = issuesResult.data ?? [];
  const rights = rightsFrom(config?.rights);
  const ai = normalizeAiProvenance(config?.ai_provenance);
  const destinations = destinationFrom(config?.destinations);
  const providerReady = distributionProviderConfigured();
  let stores: ProviderStore[] = [];
  let storeCatalogError: string | null = null;
  if (providerReady) {
    try {
      stores = (await getDistributionProvider().listStores()).filter((store) => store.active);
    } catch (error) {
      storeCatalogError = error instanceof Error ? error.message : "Store catalog unavailable";
    }
  }

  const currentProviderIssues: DistributionIssue[] = persistedIssues
    .filter((issue: any) => issue.source !== "ensemblis")
    .map((issue: any) => ({
      code: issue.code,
      title: issue.title,
      detail: issue.detail,
      severity: issue.severity,
      source: issue.source,
      objectType: issue.object_type ?? undefined,
      objectId: issue.object_id ?? undefined,
      storeId: issue.store_id ?? undefined,
    }));
  if (!config?.provider_release_id) currentProviderIssues.push({
    code: "provider.release_not_prepared",
    title: "Provider catalog preparation is pending",
    detail: "The Ensemblis distribution operator still needs to prepare/link this release in the provider catalog before final preflight.",
    severity: "error",
    source: "provider",
    objectType: "release",
    objectId: id,
  });
  if (!providerReady) currentProviderIssues.push({
    code: "provider.credentials_unavailable",
    title: "Distribution provider is not connected",
    detail: "Server-side Revelator credentials are not configured in this environment.",
    severity: "error",
    source: "provider",
    objectType: "account",
  });
  if (storeCatalogError) currentProviderIssues.push({
    code: "provider.store_catalog_unavailable",
    title: "Music-service catalog could not refresh",
    detail: storeCatalogError,
    severity: "error",
    source: "provider",
    objectType: "account",
  });

  const readiness = calculateDistributionReadiness({
    release,
    tracks,
    rights,
    aiProvenance: ai,
    artistProfiles: profiles,
    providerIssues: currentProviderIssues,
  });
  const state = config?.state ?? "draft";
  const locked = !["draft", "needs_attention", "ready", "rejected", "error"].includes(state);
  const canSubmit = readiness.ready && state !== "live" && Boolean(account) && account?.status !== "suspended";
  const profileFor = (platform: string) => profiles.find((profile: any) => profile.artist_name === release.artist && profile.platform === platform);
  const spotify = profileFor("spotify");
  const apple = profileFor("apple_music");
  const deliveries = deliveriesResult.data ?? [];
  const openIssues = readiness.issues;

  return <div className="distribution-page">
    <header className="distribution-header">
      <div>
        <Link className="v2-back-link" href={`/studio/releases/${release.id}?stage=publish`}>← {release.title}</Link>
        <div className="distribution-title-row"><div><span className="section-label">Ensemblis Distribution</span><h1>Music distribution</h1></div><span className={`distribution-state state-${state}`}>{stateLabel(state)}</span></div>
        <p>Prepare, validate, deliver and monitor this release across music services without duplicating release data.</p>
      </div>
      <div className="actions"><Link className="button" href="/studio/distribution">Distribution hub</Link></div>
    </header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Done</strong><span>{feedback.notice}</span></div> : null}

    <section className="distribution-readiness-card">
      <div className="distribution-score"><strong>{readiness.score}%</strong><span>{readiness.ready ? "Ready for provider submission" : `${readiness.blockingCount} blocker${readiness.blockingCount === 1 ? "" : "s"} remain`}</span><small>{readiness.warningCount} warning{readiness.warningCount === 1 ? "" : "s"} · deterministic + provider preflight</small></div>
      <div className="distribution-meter" aria-label={`Distribution readiness ${readiness.score}%`}><span style={{ width: `${readiness.score}%` }} /></div>
      <form action={runDistributionPreflight}><input type="hidden" name="release_id" value={release.id} /><button className="button primary" type="submit">Run full preflight</button></form>
    </section>

    <div className="distribution-check-grid">
      {readiness.checks.map((check) => <article className={`distribution-check ${check.status}`} key={check.key}><span aria-hidden>{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}
      <article className={`distribution-check ${config?.provider_release_id && providerReady ? "pass" : "block"}`}><span aria-hidden>{config?.provider_release_id && providerReady ? "✓" : "×"}</span><div><strong>Provider bridge</strong><small>{config?.provider_release_id && providerReady ? "Provider catalog record connected" : "Operator preparation or credentials required"}</small></div></article>
    </div>

    {openIssues.length ? <section className="distribution-section distribution-issues"><div className="distribution-section-heading"><div><span className="section-label">Needs attention</span><h2>{openIssues.length} preflight finding{openIssues.length === 1 ? "" : "s"}</h2></div></div><div className="distribution-issue-list">{openIssues.map((issue, index) => <article key={`${issue.code}-${issue.storeId ?? "all"}-${index}`} className={`issue-${issue.severity}`}><span>{issue.severity}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p>{issue.storeId ? <small>Store #{issue.storeId}</small> : null}</div></article>)}</div></section> : null}

    {!account ? <section className="distribution-section distribution-callout"><div><span className="section-label">One-time setup</span><h2>Distribution onboarding is not complete</h2><p>Confirm the distribution account, legal entity and terms once. Release-specific rights remain separate and must be confirmed for every submission.</p></div><Link className="button primary" href="/studio/distribution#onboarding">Complete onboarding</Link></section> : null}

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Release declarations</span><h2>Rights, AI provenance and destinations</h2><p>Ensemblis can detect and recommend metadata, but it never legally attests on your behalf.</p></div>{locked ? <span className="distribution-lock">Locked after submission</span> : null}</div>
      <form action={saveDistributionDeclarations} className="distribution-form">
        <input type="hidden" name="release_id" value={release.id} />
        <fieldset disabled={locked}>
          <div className="distribution-form-block"><h3>Rights confirmation</h3><div className="distribution-checkboxes">
            <label><input type="checkbox" name="master_rights_confirmed" defaultChecked={rights.masterRightsConfirmed} />I control the rights needed to distribute this master.</label>
            <label><input type="checkbox" name="composition_rights_confirmed" defaultChecked={rights.compositionRightsConfirmed} />I have the rights needed for the composition.</label>
            <label><input type="checkbox" name="samples_cleared" defaultChecked={rights.samplesCleared} />All samples, beats and third-party material are cleared.</label>
            <label><input type="checkbox" name="contributor_permissions_confirmed" defaultChecked={rights.contributorPermissionsConfirmed} />Contributor permissions and credits are accurate.</label>
            <label><input type="checkbox" name="ai_declaration_confirmed" defaultChecked={rights.aiDeclarationConfirmed} />The AI involvement declared below is accurate.</label>
          </div></div>

          <div className="distribution-form-block"><h3>AI provenance</h3><div className="distribution-field-grid">
            <label>Artist identity<select name="artist_identity" defaultValue={ai.artistIdentity}><option value="human">Human artist</option><option value="virtual">Virtual artist</option><option value="ai_persona">AI persona</option></select></label>
            <label>Composition<select name="composition_ai" defaultValue={ai.composition.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label>
            <label>Lyrics<select name="lyrics_ai" defaultValue={ai.lyrics.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label>
            <label>Vocals<select name="vocals_ai" defaultValue={ai.vocals.involvement}><option value="human">Human</option><option value="mixed">Mixed</option><option value="synthetic">Synthetic</option></select></label>
            <label>Instrumentation<select name="instrumentation_ai" defaultValue={ai.instrumentation.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label>
            <label>Production<select name="production_ai" defaultValue={ai.production.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label>
          </div><div className="distribution-field-grid provider-grid">
            <label>Composition AI provider<input name="composition_provider" defaultValue={ai.composition.provider ?? ""} placeholder="e.g. Suno" /></label>
            <label>Lyrics AI provider<input name="lyrics_provider" defaultValue={ai.lyrics.provider ?? ""} placeholder="Optional" /></label>
            <label>Vocal AI provider<input name="vocals_provider" defaultValue={ai.vocals.provider ?? ""} placeholder="Optional" /></label>
            <label>Instrumentation provider<input name="instrumentation_provider" defaultValue={ai.instrumentation.provider ?? ""} placeholder="Optional" /></label>
            <label>Production provider<input name="production_provider" defaultValue={ai.production.provider ?? ""} placeholder="Optional" /></label>
          </div><div className="distribution-checkboxes compact"><label><input type="checkbox" name="cloned_voice" defaultChecked={ai.vocals.clonedVoice} />This recording uses a cloned/replicated voice.</label><label><input type="checkbox" name="voice_authorization_confirmed" defaultChecked={ai.vocals.authorizationConfirmed === true} />I am authorized to use any cloned/replicated voice declared above.</label></div></div>

          <div className="distribution-form-block"><h3>Music services</h3><div className="distribution-radio-row"><label><input type="radio" name="destination_mode" value="all_enabled" defaultChecked={destinations.mode !== "custom"} />All currently enabled services <small>Recommended. Ensemblis resolves the provider catalog at submission time.</small></label><label><input type="radio" name="destination_mode" value="custom" defaultChecked={destinations.mode === "custom"} />Choose services manually</label></div>
            {stores.length ? <details className="distribution-store-picker" open={destinations.mode === "custom"}><summary>Customize {stores.length} available services</summary><div>{stores.map((store) => <label key={store.id}><input type="checkbox" name="store_id" value={store.id} defaultChecked={destinations.storeIds.includes(store.id)} />{store.name}</label>)}</div></details> : <p className="distribution-muted">{providerReady ? "The provider store catalog will appear after a successful connection." : "Connect Revelator to resolve available stores dynamically."}</p>}
          </div>

          <div className="distribution-form-block"><h3>UGC monetization</h3><p>YouTube Content ID and other UGC systems require stricter exclusive-rights confirmation than normal streaming delivery.</p><div className="distribution-checkboxes"><label><input type="checkbox" name="ugc_enabled" defaultChecked={rights.ugc.enabled} />Enable UGC monetization where eligible.</label><label><input type="checkbox" name="ugc_exclusive_master_confirmed" defaultChecked={rights.ugc.exclusiveMasterConfirmed} />I exclusively control this master for UGC monetization.</label><label><input type="checkbox" name="ugc_no_unlicensed_samples_confirmed" defaultChecked={rights.ugc.noUnlicensedSamplesConfirmed} />No unlicensed samples are present.</label><label><input type="checkbox" name="ugc_no_nonexclusive_beats_confirmed" defaultChecked={rights.ugc.noNonExclusiveBeatsConfirmed} />No non-exclusive beats are present.</label><label><input type="checkbox" name="ugc_no_unauthorized_voices_confirmed" defaultChecked={rights.ugc.noUnauthorizedVoicesConfirmed} />No unauthorized voices are present.</label></div></div>
        </fieldset>
        {!locked ? <div className="actions"><button className="button primary" type="submit">Save declarations</button><span className="distribution-muted">Saving invalidates the previous preflight by design.</span></div> : null}
      </form>
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Artist identity</span><h2>DSP profile mapping</h2><p>Confirm once to prevent the release from landing on the wrong artist profile.</p></div></div>
      <div className="distribution-profile-grid">
        {[{ id: "spotify", label: "Spotify", profile: spotify }, { id: "apple_music", label: "Apple Music", profile: apple }].map(({ id: platform, label, profile }) => <form action={saveDistributionArtistProfile} className="distribution-profile-card" key={platform}><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="platform" value={platform} /><div><span>{label}</span><strong>{profile?.status === "confirmed" ? "Confirmed" : profile?.status === "create_new" ? "Create new profile" : "Needs confirmation"}</strong></div><label>Artist/profile ID<input name="external_artist_id" defaultValue={profile?.external_artist_id ?? ""} disabled={locked} /></label><label>Profile URL<input name="external_url" defaultValue={profile?.external_url ?? ""} disabled={locked} /></label><label className="inline-check"><input type="checkbox" name="create_new" defaultChecked={profile?.status === "create_new"} disabled={locked} />This release should create a new artist profile.</label>{!locked ? <button className="button" type="submit">Save {label}</button> : null}</form>)}
      </div>
    </section>

    {deliveries.length ? <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">Delivery status</span><h2>{deliveries.length} music service{deliveries.length === 1 ? "" : "s"} reporting</h2><p>Delivered means the DSP received the package. Live is shown only when the provider confirms an on-store state.</p></div><form action={syncDistributionStatus}><input type="hidden" name="release_id" value={release.id} /><button className="button" type="submit">Refresh status</button></form></div><div className="distribution-delivery-grid">{deliveries.map((delivery: any) => <article key={delivery.id}><div><strong>{delivery.store_name}</strong><span className={`distribution-state state-${delivery.state}`}>{stateLabel(delivery.state)}</span></div><small>{delivery.provider_status ? `Provider status: ${delivery.provider_status}` : "Awaiting provider status"}</small>{delivery.store_url ? <a href={delivery.store_url} target="_blank" rel="noreferrer">Open store ↗</a> : null}</article>)}</div></section> : locked ? <section className="distribution-section distribution-callout"><div><span className="section-label">Delivery tracking</span><h2>Waiting for store delivery states</h2><p>The release has entered distribution. Refresh provider status to populate per-store delivery records.</p></div><form action={syncDistributionStatus}><input type="hidden" name="release_id" value={release.id} /><button className="button primary" type="submit">Refresh status</button></form></section> : null}

    {!locked ? <section className="distribution-section distribution-submit-card"><div><span className="section-label">Final confirmation</span><h2>{canSubmit ? "Ready when you are" : "Submission remains locked"}</h2><p>{canSubmit ? "Ensemblis will rerun local and provider validation, freeze an immutable snapshot, then submit to the selected DSPs." : "Complete onboarding, resolve every blocking preflight issue and rerun validation before distribution."}</p></div><form action={submitDistribution}><input type="hidden" name="release_id" value={release.id} /><label className="distribution-final-confirm"><input type="checkbox" name="confirm_submission" disabled={!canSubmit} />I have reviewed this release and explicitly approve distribution using the rights and AI declarations above.</label><button className="button primary" type="submit" disabled={!canSubmit}>Distribute release</button></form></section> : null}

    {(submissionsResult.data ?? []).length ? <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Audit trail</span><h2>Submission history</h2></div></div>{(submissionsResult.data ?? []).map((submission: any) => <div key={submission.id}><strong>Version {submission.version}</strong><span>{new Date(submission.submitted_at).toLocaleString("en-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>Immutable submission snapshot</small></div>)}</section> : null}
  </div>;
}
