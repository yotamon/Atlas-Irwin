import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { resolveDefaultArtistContext } from "@/lib/studio/artist-context";
import { deriveDistributionArtistState } from "@/lib/distribution/artist-facing";
import { normalizeAiProvenance, type DistributionRights } from "@/lib/distribution/domain";
import { saveDistributionReleaseMetadata } from "@/app/studio/distribution-release-metadata-actions";
import {
  addDistributionTrackContributor,
  addDistributionTrackWriter,
  removeDistributionTrackContributor,
  removeDistributionTrackWriter,
  saveDistributionArtistProfile,
  saveDistributionDeclarations,
  saveDistributionTrackMetadata,
  submitDistribution,
} from "@/app/studio/distribution-actions-safe";
import type { Json } from "@/types/database";
import type { DistributionDatabase } from "@/types/distribution-database";

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

function stateClass(tone: string) {
  if (tone === "live") return "state-live";
  if (tone === "good") return "state-ready";
  if (tone === "attention") return "state-needs_attention";
  return "state-draft";
}

export default async function ReleaseDistributionArtistView({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const feedback = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveDefaultArtistContext(supabase, user);
  const db = supabase as unknown as Db;
  const [releaseResult, tracksResult, configResult, releaseMetaResult, metadataResult, writersResult, contributorsResult, profilesResult, issuesResult] = await Promise.all([
    db.from("releases").select("*").eq("id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("tracks").select("*").eq("release_id", id).eq("owner_id", user.id).order("display_order"),
    db.from("release_distribution_configs").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_release_metadata").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).maybeSingle(),
    db.from("distribution_track_metadata").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_track_writers").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at"),
    db.from("distribution_track_contributors").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId).order("created_at"),
    db.from("distribution_artist_profiles").select("*").eq("owner_id", user.id).eq("artist_id", artist.artistId),
    db.from("distribution_validation_issues").select("*").eq("release_id", id).eq("owner_id", user.id).eq("artist_id", artist.artistId).in("status", ["open", "acknowledged"]),
  ]);
  for (const result of [releaseResult, tracksResult, configResult, releaseMetaResult, metadataResult, writersResult, contributorsResult, profilesResult, issuesResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  if (!releaseResult.data) notFound();

  const release = releaseResult.data;
  const tracks = tracksResult.data ?? [];
  const trackIds = new Set(tracks.map((track) => track.id));
  const trackMetadata = (metadataResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const writers = (writersResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const contributors = (contributorsResult.data ?? []).filter((row) => trackIds.has(row.track_id));
  const profiles = (profilesResult.data ?? []).filter((row) => row.artist_name === release.artist);
  const config = configResult.data;
  const releaseMeta = releaseMetaResult.data;
  const state = deriveDistributionArtistState({
    release,
    tracks,
    config,
    releaseMetadata: releaseMeta,
    trackMetadata,
    writers,
    contributors,
    artistProfiles: profiles,
    openIssues: issuesResult.data ?? [],
  });
  const locked = state.submitted && !["rejected", "error"].includes(config?.state ?? "");
  const rights = rightsFrom(config?.rights);
  const ai = normalizeAiProvenance(config?.ai_provenance);
  const destination = object(config?.destinations);
  const destinationMode = destination.mode === "custom" ? "custom" : "all_enabled";
  const storeIds = Array.isArray(destination.storeIds) ? destination.storeIds.map(Number).filter(Number.isFinite) : [];
  const hiddenArtist = <input type="hidden" name="artist_id" value={artist.artistId} />;

  return <div className="distribution-page distribution-release-workspace">
    <header className="distribution-header">
      <div>
        <Link className="v2-back-link" href={`/studio/releases/${release.id}`}>← {release.title}</Link>
        <div className="distribution-title-row">
          <div><span className="section-label">Release Mission · Distribution</span><h1>Deliver {release.title}</h1></div>
          <span className={`distribution-state ${stateClass(state.tone)}`}>{state.label}</span>
        </div>
        <p>Ensemblis keeps provider operations out of the way. Complete the canonical release facts and decisions below; the provider package stays an implementation detail.</p>
      </div>
      <div className="actions"><Link className="button" href="/studio/distribution">All releases</Link></div>
    </header>

    {feedback.error ? <div className="distribution-feedback error" role="alert"><strong>Action needed</strong><span>{feedback.error}</span></div> : null}
    {feedback.notice ? <div className="distribution-feedback success" role="status"><strong>Done</strong><span>{feedback.notice}</span></div> : null}

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">Needs you</span><h2>{state.decisions.length ? `${state.decisions.length} exact item${state.decisions.length === 1 ? "" : "s"}` : "Nothing is blocking delivery"}</h2><p>No readiness score. These are the concrete facts or decisions that still matter.</p></div></div>
      {state.decisions.length ? <div className="distribution-issue-list">{state.decisions.map((decision) => <article key={decision.key} className={decision.severity === "review" ? "issue-warning" : "issue-error"}><span>{decision.severity}</span><div><strong>{decision.title}</strong><p>{decision.detail}</p><small>{decision.section}</small></div></article>)}</div> : <div className="distribution-feedback success"><strong>Release package complete</strong><span>Ensemblis has all artist-owned facts and declarations required for the final approval boundary.</span></div>}
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">01 · Release identity</span><h2>What stores should receive</h2><p>Label and UPC stay on the canonical Ensemblis release. Provider IDs never become the source of truth.</p></div>{locked ? <span className="distribution-lock">Locked after submission</span> : null}</div>
      <form action={saveDistributionReleaseMetadata} className="distribution-form">
        {hiddenArtist}<input type="hidden" name="release_id" value={release.id} />
        <fieldset disabled={locked}>
          <div className="distribution-field-grid">
            <label>Label / imprint<input name="label_name" defaultValue={release.label ?? ""} placeholder={release.artist} /></label>
            <label>Metadata language<input name="metadata_language_code" required defaultValue={releaseMeta?.metadata_language_code ?? "en"} placeholder="en" /></label>
            <label>Catalog number<input name="catalog_number" defaultValue={releaseMeta?.catalog_number ?? ""} placeholder="Optional" /></label>
            <label>Original release date<input name="original_release_date" type="date" defaultValue={releaseMeta?.original_release_date ?? ""} /></label>
            <label>Pre-order date<input name="preorder_date" type="date" defaultValue={releaseMeta?.preorder_date ?? ""} /></label>
          </div>
          <div className="distribution-form-block"><h3>Release code</h3><div className="distribution-radio-row">
            <label><input type="radio" name="upc_source" value="provider" defaultChecked={(releaseMeta?.upc_source ?? (release.upc ? "artist" : "provider")) === "provider"} />Let the distribution provider assign a UPC <small>The canonical release will retain it once assigned.</small></label>
            <label><input type="radio" name="upc_source" value="artist" defaultChecked={(releaseMeta?.upc_source ?? (release.upc ? "artist" : "provider")) === "artist"} />Use my UPC/EAN</label>
          </div><label>UPC / EAN<input name="upc" defaultValue={release.upc ?? ""} inputMode="numeric" placeholder="Leave blank for provider assignment" /></label></div>
          <div className="distribution-field-grid">
            <label>Product copyright line<input name="product_copyright_line" defaultValue={releaseMeta?.product_copyright_line ?? ""} placeholder={`© ${new Date().getUTCFullYear()} ${release.label || release.artist}`} /></label>
            <label>Sound-recording copyright line<input name="recording_copyright_line" defaultValue={releaseMeta?.recording_copyright_line ?? ""} placeholder={`℗ ${new Date().getUTCFullYear()} ${release.label || release.artist}`} /></label>
          </div>
        </fieldset>
        {!locked ? <div className="actions"><button className="button primary" type="submit">Save release identity</button></div> : null}
      </form>
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">02 · Track facts & credits</span><h2>One canonical credit sheet per track</h2><p>ISRC may be supplied or left blank for assignment. Provider-specific contributor IDs remain hidden adapter details.</p></div></div>
      <div className="distribution-track-list">{tracks.map((track, index) => {
        const meta = trackMetadata.find((row) => row.track_id === track.id);
        const trackWriters = writers.filter((row) => row.track_id === track.id);
        const trackContributors = contributors.filter((row) => row.track_id === track.id);
        const share = trackWriters.reduce((sum, writer) => sum + Number(writer.share), 0);
        const datalistId = `artist-facing-contributor-roles-${track.id}`;
        return <article className="distribution-track-card" key={track.id}>
          <div className="distribution-track-heading"><div><span>Track {index + 1}</span><h3>{track.title}</h3><small>{track.audio_url ? "Master attached" : "Master missing"} · writer shares {share.toFixed(2)}%</small></div></div>
          <form action={saveDistributionTrackMetadata} className="distribution-track-metadata-form">{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><fieldset disabled={locked}><div className="distribution-field-grid"><label>Metadata language<input name="metadata_language_code" required defaultValue={meta?.metadata_language_code ?? "en"} /></label><label>Audio language<input name="audio_language_code" required defaultValue={meta?.audio_language_code ?? "en"} /></label><label>Origin<select name="track_origin" defaultValue={meta?.track_origin ?? "original"}><option value="original">Original</option><option value="cover">Cover</option><option value="public_domain">Public domain</option></select></label><label>ISRC<input name="isrc" defaultValue={meta?.isrc ?? ""} placeholder="Blank = assign for me" /></label></div><label className="inline-check"><input type="checkbox" name="explicit" defaultChecked={meta?.explicit ?? false} />Explicit lyrics/content</label></fieldset>{!locked ? <button className="button" type="submit">Save track facts</button> : null}</form>
          <div className="distribution-credit-columns"><div><div className="distribution-credit-title"><strong>Writers</strong><span>{share.toFixed(2)} / 100%</span></div>{trackWriters.map((writer) => <div className="distribution-credit-list" key={writer.id}><div><span><strong>{writer.legal_name}</strong><small>{writer.role.replaceAll("_", " ")} · {writer.share}%{writer.publisher_name ? ` · ${writer.publisher_name}` : ""}</small></span>{!locked ? <form action={removeDistributionTrackWriter}>{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="writer_id" value={writer.id} /><button type="submit" aria-label={`Remove ${writer.legal_name}`}>×</button></form> : null}</div></div>)}{!locked ? <form action={addDistributionTrackWriter} className="distribution-credit-form">{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><input name="legal_name" required placeholder="Legal writer name" /><select name="role" defaultValue="composer_lyricist"><option value="composer_lyricist">Composer & lyricist</option><option value="composer">Composer</option><option value="lyricist">Lyricist</option></select><input name="share" required type="number" min="0.01" max="100" step="0.01" placeholder="Share %" /><select name="publishing_type" defaultValue="copyright_control"><option value="copyright_control">Copyright control</option><option value="published">Published</option><option value="public_domain">Public domain</option></select><input name="publisher_name" placeholder="Publisher, if published" /><button className="button" type="submit">Add writer</button></form> : null}</div>
          <div><div className="distribution-credit-title"><strong>Production & engineering</strong><span>{trackContributors.length}</span></div>{trackContributors.map((contributor) => <div className="distribution-credit-list" key={contributor.id}><div><span><strong>{contributor.name}</strong><small>{contributor.role}</small></span>{!locked ? <form action={removeDistributionTrackContributor}>{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="contributor_id" value={contributor.id} /><button type="submit" aria-label={`Remove ${contributor.name}`}>×</button></form> : null}</div></div>)}{!locked ? <form action={addDistributionTrackContributor} className="distribution-credit-form">{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="track_id" value={track.id} /><input name="name" required placeholder="Contributor name" /><input name="role" required list={datalistId} placeholder="Producer" /><datalist id={datalistId}><option value="Producer" /><option value="Mixing Engineer" /><option value="Mastering Engineer" /><option value="Recording Engineer" /></datalist><button className="button" type="submit">Add credit</button></form> : null}</div></div>
        </article>;
      })}</div>
    </section>

    <section className="distribution-section">
      <div className="distribution-section-heading"><div><span className="section-label">03 · Rights & provenance</span><h2>Your explicit approval boundary</h2><p>Ensemblis can prepare this information, but only you can make these declarations.</p></div></div>
      <form action={saveDistributionDeclarations} className="distribution-form">{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="destination_mode" value={destinationMode} />{storeIds.map((storeId) => <input key={storeId} type="hidden" name="store_id" value={storeId} />)}
        <fieldset disabled={locked}>
          <div className="distribution-field-grid"><label>Product copyright holder<input name="product_copyright_holder" required defaultValue={rights.productCopyrightHolder} placeholder={release.label || release.artist} /></label><label>Sound-recording copyright holder<input name="recording_copyright_holder" required defaultValue={rights.recordingCopyrightHolder} placeholder={release.label || release.artist} /></label><label>Copyright year<input name="copyright_year" required type="number" min="1900" max="2100" defaultValue={rights.copyrightYear ?? new Date().getUTCFullYear()} /></label></div>
          <div className="distribution-checkboxes"><label><input type="checkbox" name="master_rights_confirmed" defaultChecked={rights.masterRightsConfirmed} />I control the rights required to distribute this master.</label><label><input type="checkbox" name="composition_rights_confirmed" defaultChecked={rights.compositionRightsConfirmed} />I have the required composition rights.</label><label><input type="checkbox" name="samples_cleared" defaultChecked={rights.samplesCleared} />All samples, beats and third-party material are cleared.</label><label><input type="checkbox" name="contributor_permissions_confirmed" defaultChecked={rights.contributorPermissionsConfirmed} />Contributor permissions and credits are accurate.</label><label><input type="checkbox" name="ai_declaration_confirmed" defaultChecked={rights.aiDeclarationConfirmed} />The AI involvement declared below is accurate.</label></div>
          <details className="distribution-store-picker"><summary>AI provenance and UGC details</summary><div className="distribution-field-grid"><label>Artist identity<select name="artist_identity" defaultValue={ai.artistIdentity}><option value="human">Human artist</option><option value="virtual">Virtual artist</option><option value="ai_persona">AI persona</option></select></label><label>Composition<select name="composition_ai" defaultValue={ai.composition.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Lyrics<select name="lyrics_ai" defaultValue={ai.lyrics.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Vocals<select name="vocals_ai" defaultValue={ai.vocals.involvement}><option value="human">Human</option><option value="mixed">Mixed</option><option value="synthetic">Synthetic</option></select></label><label>Instrumentation<select name="instrumentation_ai" defaultValue={ai.instrumentation.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label><label>Production<select name="production_ai" defaultValue={ai.production.involvement}><option value="none">No AI</option><option value="assisted">AI assisted</option><option value="generated">AI generated</option></select></label></div><input type="hidden" name="composition_provider" value={ai.composition.provider ?? ""} /><input type="hidden" name="lyrics_provider" value={ai.lyrics.provider ?? ""} /><input type="hidden" name="vocals_provider" value={ai.vocals.provider ?? ""} /><input type="hidden" name="instrumentation_provider" value={ai.instrumentation.provider ?? ""} /><input type="hidden" name="production_provider" value={ai.production.provider ?? ""} /><div className="distribution-checkboxes"><label><input type="checkbox" name="cloned_voice" defaultChecked={ai.vocals.clonedVoice} />This recording uses a cloned or replicated voice.</label><label><input type="checkbox" name="voice_authorization_confirmed" defaultChecked={ai.vocals.authorizationConfirmed === true} />I am authorized to use every cloned or replicated voice.</label><label><input type="checkbox" name="ugc_enabled" defaultChecked={rights.ugc.enabled} />Enable UGC monetization where eligible.</label><label><input type="checkbox" name="ugc_exclusive_master_confirmed" defaultChecked={rights.ugc.exclusiveMasterConfirmed} />I exclusively control this master for UGC monetization.</label><label><input type="checkbox" name="ugc_no_unlicensed_samples_confirmed" defaultChecked={rights.ugc.noUnlicensedSamplesConfirmed} />No unlicensed samples are present.</label><label><input type="checkbox" name="ugc_no_nonexclusive_beats_confirmed" defaultChecked={rights.ugc.noNonExclusiveBeatsConfirmed} />No non-exclusive beats are present.</label><label><input type="checkbox" name="ugc_no_unauthorized_voices_confirmed" defaultChecked={rights.ugc.noUnauthorizedVoicesConfirmed} />No unauthorized voices are present.</label></div></details>
        </fieldset>{!locked ? <div className="actions"><button className="button primary" type="submit">Save rights & provenance</button></div> : null}
      </form>
    </section>

    <section className="distribution-section"><div className="distribution-section-heading"><div><span className="section-label">04 · Artist profiles</span><h2>Prevent catalog mis-mapping</h2><p>Ensemblis never silently guesses whether a DSP profile is yours.</p></div></div><div className="distribution-profile-grid">{[{ platform: "spotify", label: "Spotify" }, { platform: "apple_music", label: "Apple Music" }].map(({ platform, label }) => {
      const profile = profiles.find((row) => row.platform === platform);
      return <form action={saveDistributionArtistProfile} className="distribution-profile-card" key={platform}>{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><input type="hidden" name="platform" value={platform} /><div><span>{label}</span><strong>{profile?.status === "confirmed" ? "Existing profile confirmed" : profile?.status === "create_new" ? "New profile requested" : "Needs confirmation"}</strong></div><label>Artist/profile ID<input name="external_artist_id" defaultValue={profile?.external_artist_id ?? ""} disabled={locked} /></label><label>Profile URL<input name="external_url" defaultValue={profile?.external_url ?? ""} disabled={locked} /></label><label className="inline-check"><input type="checkbox" name="create_new" defaultChecked={profile?.status === "create_new"} disabled={locked} />Create a new artist profile for this identity.</label>{!locked ? <button className="button" type="submit">Save {label}</button> : null}</form>;
    })}</div></section>

    {state.readyForApproval ? <section className="distribution-section distribution-package-card"><div><span className="section-label">Final boundary</span><h2>Ready for your distribution approval</h2><p>Submission is irreversible external work. Ensemblis will never infer this approval from an autonomy setting.</p></div><form action={submitDistribution}>{hiddenArtist}<input type="hidden" name="release_id" value={release.id} /><label className="inline-check"><input type="checkbox" name="confirm_submission" required />I reviewed this release and approve distribution.</label><button className="button primary" type="submit">Approve distribution</button></form></section> : null}
  </div>;
}
