import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import {
  calculateDistributionReadiness,
  normalizeAiProvenance,
  type DistributionIssue,
  type DistributionRights,
} from "@/lib/distribution/domain";
import { distributionProviderConfigured, getDistributionProvider, type ProviderStore } from "@/lib/distribution/provider";
import {
  addDistributionTrackContributor,
  addDistributionTrackWriter,
  prepareDistributionCatalog,
  removeDistributionTrackContributor,
  removeDistributionTrackWriter,
  runDistributionPreflight,
  saveDistributionArtistProfile,
  saveDistributionDeclarations,
  saveDistributionTrackMetadata,
  submitDistribution,
  syncDistributionStatus,
} from "@/app/studio/distribution-actions-safe";
import type { Json } from "@/types/database";
import type {
  DistributionDatabase,
  DistributionTrackContributor,
  DistributionTrackMetadata,
  DistributionTrackWriter,
} from "@/types/distribution-database";

export const metadata = { title: "Music Distribution" };

type Db = SupabaseClient<DistributionDatabase>;

function object(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rightsFrom(value: Json | null | undefined): DistributionRights {
  const raw = object(value);
  const ugc = object(raw.ugc as Json | undefined);
  const year = Number(raw.copyrightYear);
  return {
    masterRightsConfirmed: raw.masterRightsConfirmed === true,
    compositionRightsConfirmed: raw.compositionRightsConfirmed === true,
    samplesCleared: raw.samplesCleared === true,
    contributorPermissionsConfirmed: raw.contributorPermissionsConfirmed === true,
    aiDeclarationConfirmed: raw.aiDeclarationConfirmed === true,
    productCopyrightHolder: String(raw.productCopyrightHolder ?? "").trim(),
    recordingCopyrightHolder: String(raw.recordingCopyrightHolder ?? "").trim(),
    copyrightYear: Number.isFinite(year) ? year : null,
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
    mode: raw.mode === "custom" ? "custom" as const : "all_enabled" as const,
    storeIds: Array.isArray(raw.storeIds) ? raw.storeIds.map(Number).filter(Number.isFinite) : [],
  };
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
    error: "Needs reconciliation",
  };
  return labels[state] ?? state.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function creditsReadiness(
  tracks: Array<{ id: string; title: string; audio_url: string | null }>,
  metadataRows: DistributionTrackMetadata[],
  writers: DistributionTrackWriter[],
  contributors: DistributionTrackContributor[],
) {
  const issues: DistributionIssue[] = [];
  const metadataByTrack = new Map(metadataRows.map((row) => [row.track_id, row]));
  for (const track of tracks) {
    const metadata = metadataByTrack.get(track.id);
    if (!metadata) issues.push({ code: "credits.track_metadata", title: `Complete distribution metadata for ${track.title}`, detail: "Choose metadata/audio language, explicit status and track origin.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    const trackWriters = writers.filter((writer) => writer.track_id === track.id);
    if (!trackWriters.length) issues.push({ code: "credits.writer_missing", title: `Add writer credits for ${track.title}`, detail: "At least one legal composer or lyricist identity is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    else {
      const total = trackWriters.reduce((sum, writer) => sum + Number(writer.share), 0);
      if (Math.abs(total - 100) > 0.01) issues.push({ code: "credits.writer_share", title: `Writer shares for ${track.title} must total 100%`, detail: `Current total is ${total.toFixed(2)}%.`, severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
      if (trackWriters.some((writer) => writer.publishing_type === "published" && !writer.publisher_name?.trim())) issues.push({ code: "credits.publisher_missing", title: `Add publisher details for ${track.title}`, detail: "Published writers require a publisher name.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
    }
    if (!contributors.some((contributor) => contributor.track_id === track.id)) issues.push({ code: "credits.production_missing", title: `Add a production credit for ${track.title}`, detail: "At least one production or engineering credit is required.", severity: "error", source: "ensemblis", objectType: "track", objectId: track.id });
  }
  return { ready: issues.length === 0, detail: issues.length ? `${issues.length} catalog metadata issue${issues.length === 1 ? "" : "s"} remain` : "Track metadata, writers and production credits are complete", issues };
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
  const db = supabase as unknown as Db;
  const [releaseResult, tracksResult, configResult, accountResult, profilesResult, issuesResult, deliveriesResult, submissionsResult, metadataResult, writersResult, contributorsResult, operationsResult] = await Promise.all([
    db.from("releases").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle(),
    db.from("tracks").select("*").eq("release_id", id).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", id).eq("owner_id", user.id).maybeSingle(),
    db.from("distribution_accounts").select("*").eq("owner_id", user.id).eq("provider", "revelator").maybeSingle(),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id),
    db.from("distribution_validation_issues").select("*").eq("release_id", id).eq("owner_id", user.id).in("status", ["open", "acknowledged"]).order("severity"),
    db.from("distribution_deliveries").select("*").eq("release_id", id).eq("owner_id", user.id).order("store_name"),
    db.from("distribution_submissions").select("id,version,submitted_at,provider,provider_release_id,state").eq("release_id", id).eq("owner_id", user.id).order("version", { ascending: false }).limit(8),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id).order("created_at"),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id).order("created_at"),
    db.from("distribution_provider_operations").select("*").eq("release_id", id).eq("owner_id", user.id).order("created_at", { ascending: false }).limit(12),
  ]);
  if (!releaseResult.data) notFound();
  for (const result of [tracksResult, configResult, accountResult, profilesResult, issuesResult, deliveriesResult, submissionsResult, metadataResult, writersResult, contributorsResult, operationsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const release = releaseResult.data;
  const tracks = tracksResult.data ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const config = configResult.data;
  const account = accountResult.data;
  const profiles = (profilesResult.data ?? []).filter((profile) => profile.artist_name === release.artist);
  const metadataRows = (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const writers = (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const contributors = (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const persistedIssues = issuesResult.data ?? [];
  const rights = rightsFrom(config?.rights);
  const ai = normalizeAiProvenance(config?.ai_provenance);
  const destinations = destinationFrom(config?.destinations);
  const providerReady = distributionProviderConfigured();
  const credits = creditsReadiness(tracks, metadataRows, writers, contributors);
  const localReadiness = calculateDistributionReadiness({ release, tracks, rights, aiProvenance: ai, artistProfiles: profiles, creditsReady: credits });
  const state = config?.state ?? "draft";
  const locked = !["draft", "needs_attention", "ready", "rejected", "error"].includes(state);
  const unresolvedOperations = (operationsResult.data ?? []).filter((operation) => ["started", "ambiguous"].includes(operation.state));

  let stores: ProviderStore[] = [];
  let storeCatalogError: string | null = null;
  if (providerReady) {
    try {
      stores = (await getDistributionProvider().listStores()).filter((store) => store.active);
    } catch (error) {
      storeCatalogError = error instanceof Error ? error.message : "Music-service catalog unavailable";
    }
  }

  const providerIssues: DistributionIssue[] = persistedIssues.filter((issue) => issue.source !== "ensemblis").map((issue) => ({
    code: issue.code,
    title: issue.title,
    detail: issue.detail,
    severity: issue.severity,
    source: issue.source,
    objectType: issue.object_type === "release" || issue.object_type === "track" || issue.object_type === "artist" || issue.object_type === "rights" || issue.object_type === "artwork" || issue.object_type === "account" ? issue.object_type : undefined,
    objectId: issue.object_id ?? undefined,
    storeId: issue.store_id ?? undefined,
  }));
  if (!config?.provider_release_id) providerIssues.push({ code: "provider.release_not_prepared", title: "Prepare the distribution package", detail: "The provider catalog package has not been created yet. Complete local readiness, then prepare it from this page.", severity: "error", source: "provider", objectType: "release", objectId: id });
  if (!providerReady) providerIssues.push({ code: "provider.credentials_unavailable", title: "Distribution connection is unavailable", detail: "Server-side distribution credentials are not configured in this environment.", severity: "error", source: "provider", objectType: "account" });
  if (storeCatalogError) providerIssues.push({ code: "provider.store_catalog_unavailable", title: "Music-service catalog could not refresh", detail: storeCatalogError, severity: "error", source: "provider", objectType: "account" });
  const readiness = calculateDistributionReadiness({ release, tracks, rights, aiProvenance: ai, artistProfiles: profiles, providerIssues, creditsReady: credits });

  const profileFor = (platform: string) => profiles.find((profile) => profile.platform === platform);
  const spotify = profileFor("spotify");
  const apple = profileFor("apple_music");
  const deliveries = deliveriesResult.data ?? [];
  const accountEligible = Boolean(account?.agreement_accepted_at && account.rights_terms_accepted_at && !["setup_required", "restricted", "suspended"].includes(account.status));
  const canPrepare = !locked && localReadiness.ready && accountEligible && providerReady && unresolvedOperations.filter((operation) => ["prepare_catalog", "update_catalog"].includes(operation.operation_type)).length === 0;
  const canSubmit = !locked && state === "ready" && readiness.ready && accountEligible && unresolvedOperations.filter((operation) => operation.operation_type === "submit").length === 0;

  return <div className="distribution-page distribution-release-workspace">
    <header className="distribution-header">
      <div><Link className="v2-back-link" href={`/studio/releases/${release.id}?stage=publish`}>← {release.title}</Link><div className="distribution-title-row"><div><span className="section-label">Ensemblis Distribution</span><h1>Music distribution</h1></div><span className={`distribution-state state-${state}`}>{stateLabel(state)}</span></div><p>Complete one canonical release package, validate it against store requirements, approve delivery, then monitor every destination.</p></div>
      <div className="actions"><Link className="button" href="/studio/distribution">Distribution hub</Link></div>
    </header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Done</strong><span>{feedback.notice}</span></div> : null}
    {unresolvedOperations.length ? <div className="distribution-feedback error" role="alert"><strong>External operation needs reconciliation</strong><span>Ensemblis has blocked automatic retries because {unresolvedOperations.length} provider operation{unresolvedOperations.length === 1 ? " has" : "s have"} an uncertain result. Use Distribution Operations to reconcile before continuing.</span></div> : null}

    <section className="distribution-readiness-card">
      <div className="distribution-score"><strong>{readiness.score}%</strong><span>{readiness.ready ? "Ready for final approval" : `${readiness.blockingCount} blocker${readiness.blockingCount === 1 ? "" : "s"} remain`}</span><small>{readiness.warningCount} warning{readiness.warningCount === 1 ? "" : "s"} · local rules + live provider validation</small></div>
      <div className="distribution-meter" aria-label={`Distribution readiness ${readiness.score}%`}><span style={{ width: `${readiness.score}%` }} /></div>
      <div className="actions">{config?.provider_release_id ? <form action={runDistributionPreflight}><input type="hidden" name="release_id" value={release.id} /><button className="button primary" type="submit">Run full preflight</button></form> : <span className="distribution-muted">Prepare the provider package before live preflight.</span>}</div>
    </section>

    <div className="distribution-check-grid">{readiness.checks.map((check) => <article className={`distribution-check ${check.status}`} key={check.key}><span aria-hidden>{check.status === "pass" ? "✓" : check.status === "warning" ? "!" : "×"}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></article>)}<article className={`distribution-check ${config?.provider_release_id && providerReady ? "pass" : "block"}`}><span aria-hidden>{config?.provider_release_id && providerReady ? "✓" : "×"}</span><div><strong>Provider package</strong><small>{config?.provider_release_id && providerReady ? "Catalog package synchronized" : "Preparation required after local metadata is complete"}</small></div></article></div>

    {!account ? <section className="distribution-section distribution-callout"><div><span className="section-label">One-time setup</span><h2>Complete distribution onboarding first</h2><p>Confirm account identity and distribution terms once. Every release still receives its own rights and AI declaration.</p></div><Link className="button primary" href="/studio/distribution#onboarding">Complete onboarding</Link></section> : null}

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">01 · Rights & provenance</span><h2>Confirm what Ensemblis is allowed to distribute</h2><p>AI can suggest metadata. Only you can make legal rights declarations.</p></div>{locked ? <span className="distribution-lock">Locked after submission</span> : null}</div>
      <form action={saveDistributionDeclarations} className="distribution-form"><input type="hidden" name="release_id" value={release.id} /><fieldset disabled={locked}>
        <div className="distribution-form-block"><h3>Copyright identity</h3><div className="distribution-field-grid"><label>Product copyright holder<input name="product_copyright_holder" required defaultValue={rights.productCopyrightHolder} placeholder={release.label || release.artist} /></label><label>Sound-recording copyright holder<input name="recording_copyright_holder" required defaultValue={rights.recordingCopyrightHolder} placeholder={release.label || release.artist} /></label><label>Copyright year<input name="copyright_year" required type="number" min="1900" max="2100" defaultValue={rights.copyrightYear ?? new Date().getUTCFullYear()} /></label></div></div>
        <div className="distribution-form-block"><h3>Rights confirmation</h3><div className="distribution-checkboxes"><label><input type="checkbox" name="master_rights_confirmed" defaultChecked={rights.masterRightsConfirmed} />I control the rights required to distribute this master.</label><label><input type="checkbox" name="composition_rights_confirmed" defaultChecked={rights.compositionRightsConfirmed} />I have the rights required for the composition.</label><label><input type="checkbox" name="samples_cleared" defaultChecked={rights.samplesCleared} />All samples, beats and third-party material are cleared.</label><label><input type="checkbox" name="contributor_permissions_confirmed" defaultChecked={rights.contributorPermissionsConfirmed} />Contributor permissions and credits are accurate.</label><label><input type="checkbox" name="ai_declaration_confirmed" defaultChecked={rights.aiDeclarationConfirmed} />The AI involvement declared below is accurate.</label></div></div>
        <div className="distribution-form-block"><h3>AI provenance</h3><div className="distribution-field-grid"><label>Artist identity<select name="artist_identity" defaultValue={ai.artistIdentity}><option value="human">Human artist</option><option value="virtual">Virtual artist</option><option value="ai_persona">AI persona</option></select></label><label>Composition<select name="composition_ai" defaultValue={ai.composition.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Lyrics<select name="lyrics_ai" defaultValue={ai.lyrics.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Vocals<select name="vocals_ai" defaultValue={ai.vocals.involvement}><option value="human">Human</option><option value="mixed">Mixed</option><option value="synthetic">Synthetic</option></select></label><label>Instrumentation<select name="instrumentation_ai" defaultValue={ai.instrumentation.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Production<select name="production_ai" defaultValue={ai.production.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label></div><div className="distribution-field-grid provider-grid"><label>Composition AI provider<input name="composition_provider" defaultValue={ai.composition.provider ?? ""} placeholder="Optional" /></label><label>Lyrics AI provider<input name="lyrics_provider" defaultValue={ai.lyrics.provider ?? ""} placeholder="Optional" /></label><label>Vocal AI provider<input name="vocals_provider" defaultValue={ai.vocals.provider ?? ""} placeholder="Optional" /></label><label>Instrumentation provider<input name="instrumentation_provider" defaultValue={ai.instrumentation.provider ?? ""} placeholder="Optional" /></label><label>Production provider<input name="production_provider" defaultValue={ai.production.provider ?? ""} placeholder="Optional" /></label></div><div className="distribution-checkboxes compact"><label><input type="checkbox" name="cloned_voice" defaultChecked={ai.vocals.clonedVoice} />This recording uses a cloned or replicated voice.</label><label><input type="checkbox" name="voice_authorization_confirmed" defaultChecked={ai.vocals.authorizationConfirmed === true} />I am authorized to use every cloned or replicated voice declared above.</label></div></div>
        <div className="distribution-form-block"><h3>Music services</h3><div className="distribution-radio-row"><label><input type="radio" name="destination_mode" value="all_enabled" defaultChecked={destinations.mode !== "custom"} />All enabled services <small>Recommended. Ensemblis resolves the active provider catalog at submission time.</small></label><label><input type="radio" name="destination_mode" value="custom" defaultChecked={destinations.mode === "custom"} />Choose services manually</label></div>{stores.length ? <details className="distribution-store-picker" open={destinations.mode === "custom"}><summary>Customize {stores.length} available services</summary><div>{stores.map((store) => <label key={store.id}><input type="checkbox" name="store_id" value={store.id} defaultChecked={destinations.storeIds.includes(store.id)} />{store.name}</label>)}</div></details> : <p className="distribution-muted">{providerReady ? "The music-service catalog will appear when the provider connection responds." : "The distribution connection is not configured in this environment."}</p>}</div>
        <div className="distribution-form-block"><h3>UGC monetization</h3><p>Content ID and similar UGC systems require stricter exclusivity than normal streaming delivery.</p><div className="distribution-checkboxes"><label><input type="checkbox" name="ugc_enabled" defaultChecked={rights.ugc.enabled} />Enable UGC monetization where eligible.</label><label><input type="checkbox" name="ugc_exclusive_master_confirmed" defaultChecked={rights.ugc.exclusiveMasterConfirmed} />I exclusively control this master for UGC monetization.</label><label><input type="checkbox" name="ugc_no_unlicensed_samples_confirmed" defaultChecked={rights.ugc.noUnlicensedSamplesConfirmed} />No unlicensed samples are present.</label><label><input type="checkbox" name="ugc_no_nonexclusive_beats_confirmed" defaultChecked={rights.ugc.noNonExclusiveBeatsConfirmed} />No non-exclusive beats are present.</label><label><input type="checkbox" name="ugc_no_unauthorized_voices_confirmed" defaultChecked={rights.ugc.noUnauthorizedVoicesConfirmed} />No unauthorized voices are present.</label></div></div>
      </fieldset>{!locked ? <div className="actions"><button className="button primary" type="submit">Save rights & provenance</button><span className="distribution-muted">Saving invalidates the previous preflight and requires package synchronization.</span></div> : null}</form>
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">02 · Track metadata & credits</span><h2>Complete the catalog facts DSPs actually inspect</h2><p>Writer splits and production credits are canonical Ensemblis data, not provider-specific fields.</p></div></div>
      <div className="distribution-track-list">{tracks.map((track, index) => {
        const trackMetadata = metadataRows.find((row) => row.track_id === track.id);
        const trackWriters = writers.filter((writer) => writer.track_id === track.id);
        const trackContributors = contributors.filter((contributor) => contributor.track_id === track.id);
        const share = trackWriters.reduce((sum, writer) => sum + Number(writer.share), 0);
        const datalistId = `contributor-roles-${track.id}`;
        return <article className="distribution-track-card" key={track.id}><div className="distribution-track-heading"><div><span>Track {index + 1}</span><h3>{track.title}</h3><small>{track.audio_url ? "Master attached" : "Master missing"} · writers {share.toFixed(0)}%</small></div><span className={`distribution-state ${trackMetadata && trackWriters.length && trackContributors.length && Math.abs(share - 100) < 0.01 ? "state-live" : "state-needs_attention"}`}>{trackMetadata && trackWriters.length && trackContributors.length && Math.abs(share - 100) < 0.01 ? "Complete" : "Needs metadata"}</span></div>
          <form action={saveDistributionTrackMetadata} className="distribution-track-metadata-form"><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><fieldset disabled={locked}><div className="distribution-field-grid"><label>Metadata language<input name="metadata_language_code" required defaultValue={trackMetadata?.metadata_language_code ?? "en"} placeholder="en" /></label><label>Audio language<input name="audio_language_code" required defaultValue={trackMetadata?.audio_language_code ?? "en"} placeholder="en" /></label><label>Track origin<select name="track_origin" defaultValue={trackMetadata?.track_origin ?? "original"}><option value="original">Original</option><option value="cover">Cover</option><option value="public_domain">Public domain</option></select></label><label>ISRC<input name="isrc" defaultValue={trackMetadata?.isrc ?? ""} placeholder="Leave blank for assignment" /></label></div><label className="inline-check"><input type="checkbox" name="explicit" defaultChecked={trackMetadata?.explicit ?? false} />Explicit lyrics/content</label></fieldset>{!locked ? <button className="button" type="submit">Save track metadata</button> : null}</form>
          <div className="distribution-credit-columns"><div><div className="distribution-credit-title"><strong>Writers</strong><span>{share.toFixed(2)} / 100%</span></div>{trackWriters.length ? <div className="distribution-credit-list">{trackWriters.map((writer) => <div key={writer.id}><span><strong>{writer.legal_name}</strong><small>{writer.role.replaceAll("_", " ")} · {writer.share}% · {writer.publishing_type.replaceAll("_", " ")}{writer.publisher_name ? ` · ${writer.publisher_name}` : ""}</small></span>{!locked ? <form action={removeDistributionTrackWriter}><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="writer_id" value={writer.id} /><button type="submit" aria-label={`Remove ${writer.legal_name}`}>×</button></form> : null}</div>)}</div> : <p className="distribution-muted">No writer credits yet.</p>}{!locked ? <form action={addDistributionTrackWriter} className="distribution-credit-form"><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><input name="legal_name" required placeholder="Legal writer name" /><select name="role" defaultValue="composer_lyricist"><option value="composer_lyricist">Composer & lyricist</option><option value="composer">Composer</option><option value="lyricist">Lyricist</option></select><input name="share" type="number" required min="0.01" max="100" step="0.01" placeholder="Share %" /><select name="publishing_type" defaultValue="copyright_control"><option value="copyright_control">Copyright control</option><option value="published">Published</option><option value="public_domain">Public domain</option></select><input name="publisher_name" placeholder="Publisher, if published" /><button className="button" type="submit">Add writer</button></form> : null}</div>
            <div><div className="distribution-credit-title"><strong>Production & engineering</strong><span>{trackContributors.length}</span></div>{trackContributors.length ? <div className="distribution-credit-list">{trackContributors.map((contributor) => <div key={contributor.id}><span><strong>{contributor.name}</strong><small>{contributor.role}</small></span>{!locked ? <form action={removeDistributionTrackContributor}><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="contributor_id" value={contributor.id} /><button type="submit" aria-label={`Remove ${contributor.name}`}>×</button></form> : null}</div>)}</div> : <p className="distribution-muted">Add at least one production or engineering credit.</p>}{!locked ? <form action={addDistributionTrackContributor} className="distribution-credit-form"><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><input name="name" required placeholder="Contributor name" /><input name="role" required list={datalistId} placeholder="Producer" /><datalist id={datalistId}><option value="Producer" /><option value="Mixing Engineer" /><option value="Mastering Engineer" /><option value="Recording Engineer" /></datalist><button className="button" type="submit">Add credit</button></form> : null}</div></div>
        </article>;
      })}{!tracks.length ? <p className="distribution-muted">Add tracks to this release before preparing distribution metadata.</p> : null}</div>
    </section>

    <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">03 · Artist identity</span><h2>Map the release to the correct DSP artist profiles</h2><p>Use an existing profile ID, or explicitly choose a new profile. Ensemblis never guesses silently.</p></div></div><div className="distribution-profile-grid">{[{ id: "spotify", label: "Spotify", profile: spotify }, { id: "apple_music", label: "Apple Music", profile: apple }].map(({ id: platform, label, profile }) => <form action={saveDistributionArtistProfile} className="distribution-profile-card" key={platform}><input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="platform" value={platform} /><div><span>{label}</span><strong>{profile?.status === "confirmed" ? "Existing profile confirmed" : profile?.status === "create_new" ? "New profile requested" : "Needs confirmation"}</strong></div><label>Artist/profile ID<input name="external_artist_id" defaultValue={profile?.external_artist_id ?? ""} disabled={locked} /></label><label>Profile URL<input name="external_url" defaultValue={profile?.external_url ?? ""} disabled={locked} /></label><label className="inline-check"><input type="checkbox" name="create_new" defaultChecked={profile?.status === "create_new"} disabled={locked} />Create a new artist profile for this identity.</label>{!locked ? <button className="button" type="submit">Save {label}</button> : null}</form>)}</div></section>

    {!locked ? <section className="distribution-section distribution-package-card"><div><span className="section-label">04 · Provider package</span><h2>{config?.provider_release_id ? "Synchronize the distribution package" : "Prepare the distribution package"}</h2><p>{config?.provider_release_id ? "Push approved metadata, lossless masters, artwork and credits to the existing provider catalog record. Ensemblis keeps the same external release identity." : "Ensemblis will create the provider catalog record from the canonical release, upload its lossless masters and artwork, then configure release timing."}</p></div><form action={prepareDistributionCatalog}><input type="hidden" name="release_id" value={release.id} /><button className="button primary" type="submit" disabled={!canPrepare}>{config?.provider_release_id ? "Synchronize package" : "Prepare package"}</button>{!canPrepare ? <small>Resolve local blockers, onboarding, provider connectivity or an ambiguous operation first.</small> : null}</form></section> : null}

    {readiness.issues.length ? <section className="distribution-section distribution-issues"><div className="distribution-section-heading"><div><span className="section-label">05 · Preflight findings</span><h2>{readiness.issues.length} finding{readiness.issues.length === 1 ? "" : "s"}</h2></div></div><div className="distribution-issue-list">{readiness.issues.map((issue, index) => <article key={`${issue.code}-${issue.storeId ?? "all"}-${index}`} className={`issue-${issue.severity}`}><span>{issue.severity}</span><div><strong>{issue.title}</strong><p>{issue.detail}</p>{issue.storeId ? <small>Music service #{issue.storeId}</small> : null}</div></article>)}</div></section> : null}

    {deliveries.length ? <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">Delivery status</span><h2>{deliveries.length} music service{deliveries.length === 1 ? "" : "s"} reporting</h2><p>Delivered means the DSP received the package. Live appears only after provider confirmation.</p></div><form action={syncDistributionStatus}><input type="hidden" name="release_id" value={release.id} /><button className="button" type="submit">Refresh status</button></form></div><div className="distribution-delivery-grid">{deliveries.map((delivery) => <article key={delivery.id}><div><strong>{delivery.store_name}</strong><span className={`distribution-state state-${delivery.state}`}>{stateLabel(delivery.state)}</span></div><small>{delivery.provider_status ? `Provider status: ${delivery.provider_status}` : "Awaiting provider status"}</small>{delivery.store_url ? <a href={delivery.store_url} target="_blank" rel="noreferrer">Open store ↗</a> : null}</article>)}</div></section> : locked ? <section className="distribution-section distribution-callout"><div><span className="section-label">Delivery tracking</span><h2>Waiting for store delivery states</h2><p>Refresh status to reconcile provider-owned delivery progress.</p></div><form action={syncDistributionStatus}><input type="hidden" name="release_id" value={release.id} /><button className="button primary" type="submit">Refresh status</button></form></section> : null}

    {!locked ? <section className="distribution-section distribution-submit-card"><div><span className="section-label">06 · Final approval</span><h2>{canSubmit ? "Ready for your approval" : "Submission remains locked"}</h2><p>{canSubmit ? "Ensemblis will rerun provider validation, freeze an immutable versioned snapshot, then submit only to the selected services." : "Synchronize the package, run full preflight, and resolve every blocking issue first."}</p></div><form action={submitDistribution}><input type="hidden" name="release_id" value={release.id} /><label className="distribution-final-confirm"><input type="checkbox" name="confirm_submission" disabled={!canSubmit} />I reviewed this release and explicitly approve distribution using the rights, credits and AI declarations above.</label><button className="button primary" type="submit" disabled={!canSubmit}>Distribute release</button></form></section> : null}

    {(submissionsResult.data ?? []).length ? <section className="distribution-section distribution-history"><div className="distribution-section-heading"><div><span className="section-label">Immutable evidence</span><h2>Submission history</h2></div></div>{(submissionsResult.data ?? []).map((submission) => <div key={submission.id}><strong>Version {submission.version}</strong><span>{new Date(submission.submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}</span><small>{stateLabel(submission.state)} · immutable submission snapshot</small></div>)}</section> : null}
  </div>;
}
