import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { analyzeMusicTrack } from "@/app/studio/growth-media-actions-safe";
import { ActiveMasteringPanel } from "@/components/studio/active-mastering-panel";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { AnalysisSubmitButton } from "@/components/studio/analysis-submit-button";
import { CatalogTrackWorkspace } from "@/components/studio/catalog-track-workspace";
import { ContextInspector } from "@/components/studio/context-inspector";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MasteringInspectorPanel } from "@/components/studio/mastering-inspector-panel";
import { MasterReadinessCard } from "@/components/studio/master-readiness-card";
import { MasteringReferencesPanel } from "@/components/studio/mastering-references-panel";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ObjectHeader } from "@/components/studio/object-header";
import { ProcessingState } from "@/components/studio/processing-state";
import { StemIntelligencePanel } from "@/components/studio/stem-intelligence-panel";
import { TrackPreview } from "@/components/studio/track-preview";
import { NextActionWidget, ObjectActionBar, ObjectStateSummary, type ObjectAction } from "@/components/studio/ux-v4-widgets";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { deriveMasterReadiness } from "@/lib/mastering/readiness";
import { asMasteringClient } from "@/lib/mastering/jobs";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import {
  describeMusicIngestionProgress,
  describeTrackAnalysis,
} from "@/lib/studio/track-analysis-state";
import type { Json, Track } from "@/types/database";
import type { StatusTone } from "@/components/studio/ui";

type AnalysisProcessingStep = {
  label: string;
  state: "waiting" | "active" | "complete";
};

type AnalysisProcessingCopy = {
  eyebrow: string;
  title: string;
  detail: string;
  steps: AnalysisProcessingStep[];
};

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function duration(seconds: number | null) {
  if (!seconds) return "Duration pending";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function describeAnalysisProcessing(status: string, isRefreshing: boolean): AnalysisProcessingCopy {
  const masterStep: AnalysisProcessingStep = { label: "Master attached", state: "complete" };
  const readyStep: AnalysisProcessingStep = { label: "Analysis ready", state: "waiting" };

  if (status === "dispatched" || status === "running") {
    return {
      eyebrow: "Analysis · Listening",
      title: isRefreshing ? "Refreshing what Ensemblis hears." : "Ensemblis is understanding your track.",
      detail: isRefreshing
        ? "Current verified analysis stays available while Ensemblis listens again for structure, tempo, strongest sections and mastering signals."
        : "Ensemblis is listening for structure, tempo, strongest sections and mastering signals. Deep audio passes can take several minutes.",
      steps: [
        masterStep,
        { label: "Analysis queued", state: "complete" },
        { label: "Listening to master", state: "active" },
        readyStep,
      ],
    };
  }

  if (status === "queued") {
    return {
      eyebrow: "Analysis · Queued",
      title: isRefreshing ? "Your fresh analysis is queued." : "Analysis is queued.",
      detail: isRefreshing
        ? "Current verified analysis stays live while the Media Worker waits for capacity to start the fresh pass."
        : "The master is safe and waiting for the Media Worker. Analysis starts automatically when the worker is available.",
      steps: [
        masterStep,
        { label: "Analysis queued", state: "active" },
        { label: "Listening to master", state: "waiting" },
        readyStep,
      ],
    };
  }

  return {
    eyebrow: "Analysis · Preparing",
    title: isRefreshing ? "Preparing fresh analysis." : "Preparing analysis.",
    detail: isRefreshing
      ? "Nothing is being replaced yet. Current verified analysis remains live while Ensemblis prepares the new pass."
      : "The master is attached. Ensemblis is preparing the analysis job automatically.",
    steps: [
      masterStep,
      { label: "Preparing analysis", state: "active" },
      { label: "Listening to master", state: "waiting" },
      readyStep,
    ],
  };
}

export default async function TrackWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ artist?: string }>;
}) {
  const { id } = await params;
  const { artist: requestedArtistId } = await searchParams;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user, requestedArtistId);
  const href = (path: string) => ensemblisArtistHref(path, artist.artistId);
  const growth = asGrowthClient(supabase);
  const music = asArtistScopedMusicClient(supabase);
  const masteringDb = asMasteringClient(supabase);

  const { data: vaultTrack, error: vaultError } = await growth
    .from("track_vault")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .maybeSingle();
  if (vaultError) throw new Error(vaultError.message);

  if (!vaultTrack) {
    const aliasTrackResult = await music
      .from("tracks")
      .select("*")
      .eq("id", id)
      .eq("owner_id", user.id)
      .eq("artist_id", artist.artistId)
      .maybeSingle();
    if (aliasTrackResult.error) throw new Error(aliasTrackResult.error.message);

    if (aliasTrackResult.data) {
      const aliasTrack = aliasTrackResult.data as Track;
      const [aliasVaultResult, releaseResult] = await Promise.all([
        growth
          .from("track_vault")
          .select("id")
          .eq("owner_id", user.id)
          .eq("artist_id", artist.artistId)
          .eq("linked_track_id", aliasTrack.id)
          .maybeSingle(),
        music
          .from("releases")
          .select("id,title")
          .eq("id", aliasTrack.release_id)
          .eq("owner_id", user.id)
          .eq("artist_id", artist.artistId)
          .maybeSingle(),
      ]);
      if (aliasVaultResult.error) throw new Error(aliasVaultResult.error.message);
      if (releaseResult.error) throw new Error(releaseResult.error.message);
      if (aliasVaultResult.data) redirect(href(`/studio/music/${aliasVaultResult.data.id}`));
      if (releaseResult.data) {
        return <CatalogTrackWorkspace track={aliasTrack} releaseTitle={releaseResult.data.title} artistId={artist.artistId} />;
      }
    }

    notFound();
  }

  const { data: masteringReferences, error: referencesError } = await masteringDb
    .from("mastering_references")
    .select("label,reference_signature,track_vault_id")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .eq("active", true)
    .eq("status", "ready")
    .limit(24);
  if (referencesError) throw new Error(referencesError.message);

  let release: { id: string; title: string; artwork_url: string | null; cover_alt: string | null; release_date: string | null } | null = null;
  let releaseTrack: Track | null = null;
  if (vaultTrack.linked_release_id) {
    const [releaseResult, tracksResult] = await Promise.all([
      music
        .from("releases")
        .select("id,title,artwork_url,cover_alt,release_date")
        .eq("id", vaultTrack.linked_release_id)
        .eq("artist_id", artist.artistId)
        .maybeSingle(),
      music
        .from("tracks")
        .select("*")
        .eq("release_id", vaultTrack.linked_release_id)
        .eq("artist_id", artist.artistId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (releaseResult.error) throw new Error(releaseResult.error.message);
    if (tracksResult.error) throw new Error(tracksResult.error.message);
    release = releaseResult.data;
    const releaseTracks = (tracksResult.data ?? []) as Track[];
    releaseTrack = vaultTrack.linked_track_id
      ? releaseTracks.find((track) => track.id === vaultTrack.linked_track_id) ?? null
      : releaseTracks.length === 1
        ? releaseTracks[0]
        : null;
  }

  const analysis = describeTrackAnalysis(vaultTrack.analysis, vaultTrack.audio_profile);
  const ingestion = describeMusicIngestionProgress({
    hasMaster: Boolean(vaultTrack.audio_url),
    analysisValue: vaultTrack.analysis,
    musicMapValue: vaultTrack.audio_profile,
    releaseBound: Boolean(vaultTrack.linked_track_id),
  });
  const analysisNeedsRecovery = analysis.needsRecovery;
  const ingestionActive = ingestion.phase === "enriching";
  const needsArtistInput = ingestion.phase === "needs_input" && Boolean(releaseTrack);
  const needsYouHref = ingestion.inputReason === "stems_from_previous_master" ? "#stems" : "#lyrics";
  const needsYouTitle = ingestion.inputReason === "official_lyrics_missing"
    ? "Add the official lyrics"
    : ingestion.inputReason === "ai_context_disabled"
      ? "Choose whether Ensemblis may use the lyrics"
      : ingestion.inputReason === "stems_from_previous_master"
        ? "Reconnect stems to this master"
        : "One artist input can unlock more context";
  const needsYouAction = ingestion.inputReason === "official_lyrics_missing"
    ? "Add official lyrics"
    : ingestion.inputReason === "ai_context_disabled"
      ? "Review lyric permissions"
      : ingestion.inputReason === "stems_from_previous_master"
        ? "Review stems"
        : "Open source input";
  const processing = describeAnalysisProcessing(analysis.status, analysis.isRefreshing);
  const musicMap = asRecord(vaultTrack.audio_profile);
  const sections = Array.isArray(musicMap.sections) ? musicMap.sections.length : 0;
  const hooks = Array.isArray(musicMap.hook_candidates) ? musicMap.hook_candidates.length : 0;
  const bpm = typeof musicMap.bpm === "number" && Number.isFinite(musicMap.bpm) ? Math.round(musicMap.bpm) : null;
  const masterReadiness = deriveMasterReadiness(vaultTrack.audio_profile, {
    audioUrl: vaultTrack.audio_url,
    mediaAssetId: vaultTrack.media_asset_id,
    analysisActive: analysis.isActive && !analysis.hasMusicMap,
    analysisFailed: analysis.needsRecovery && !analysis.hasMusicMap,
  });
  const mastering = masterReadiness.status === "ready"
    ? "Ready"
    : masterReadiness.status === "review"
      ? "Review suggested"
      : masterReadiness.status === "fix_required"
        ? "Fix before release"
        : masterReadiness.status === "pending"
          ? "Checking"
          : vaultTrack.audio_url
            ? "Unverified"
            : null;
  const createHref = releaseTrack ? href(`/studio/create?intent=asset&track=${releaseTrack.id}`) : null;
  const mixTrackId = releaseTrack?.id ?? vaultTrack.linked_track_id;
  const mixHref = href(mixTrackId ? `/studio/music/automix?track=${mixTrackId}` : "/studio/music/automix");
  const objectActions: ObjectAction[] = !vaultTrack.audio_url
    ? [{ label: "Add master", href: href("/studio/music/import") }]
    : [
        ...(analysis.hasMusicMap && !analysis.isActive && createHref ? [{ label: "Create", href: createHref }] : []),
        { label: "Master", href: "#mastering" },
        { label: "Mix", href: mixHref },
        ...(release ? [{ label: "Open release", href: href(`/studio/releases/${release.id}`) }] : []),
      ];
  const catalogProfiles = (masteringReferences ?? [])
    .filter((reference) => reference.track_vault_id !== vaultTrack.id)
    .map((reference) => ({
    title: reference.label,
    musicMap: {
      mastering_inspector: { reference_signature: reference.reference_signature },
    } as Json,
  }));

  const trackState: { label: string; title: string; detail: string; tone: StatusTone } = !vaultTrack.audio_url
    ? { label: "Blocked", title: "Add the real master", detail: "Ensemblis needs source audio before analysis or mastering can move.", tone: "danger" }
    : analysisNeedsRecovery
      ? { label: "Needs review", title: "Analysis needs attention", detail: "The canonical master is safe. Retry only the analysis pass.", tone: "attention" }
      : mastering === "Fix before release" || mastering === "Review suggested" || needsArtistInput
        ? { label: "Needs review", title: mastering === "Fix before release" ? "The master needs attention" : needsArtistInput ? needsYouTitle : "Review the mastering result", detail: mastering === "Fix before release" ? "Resolve the mastering blocker before distribution." : needsArtistInput ? ingestion.detail : "The track is usable, but a mastering review is recommended before release.", tone: "attention" }
        : analysis.isActive || ingestionActive
          ? { label: "Working", title: analysis.isRefreshing ? "Refreshing the analysis" : "Ensemblis is finishing the track", detail: analysis.isRefreshing ? "Verified results stay available while the fresh pass runs." : ingestion.detail, tone: "accent" }
          : analysis.hasMusicMap
            ? { label: "Ready", title: "Ready for the next move", detail: "The source is understood and the next useful action is ranked below.", tone: "success" }
            : { label: "Working", title: "Analysis is preparing", detail: ingestion.detail, tone: "accent" };

  const nextAction = analysisNeedsRecovery
    ? { title: analysis.isPartial ? "Finish the full analysis" : "Retry the analysis", detail: analysis.isPartial ? "Verified results remain available, but the latest full pass stopped before completion." : "The master is safe. Retry only the analysis step.", href: "#analysis-recovery", label: "Retry analysis" }
    : mastering === "Fix before release"
      ? { title: "Fix the mastering blocker first", detail: "Mastering Inspector found a technical issue that should be corrected before distribution.", href: "#mastering", label: "Review mastering" }
      : needsArtistInput
        ? { title: `Needs You · ${needsYouTitle}`, detail: ingestion.detail, href: needsYouHref, label: needsYouAction }
        : analysis.hasMusicMap && !analysis.isActive && createHref
          ? { title: "Create from the strongest section", detail: ingestion.phase === "needs_attention" ? "Core analysis is ready even though an optional enrichment step needs attention." : "Analysis and mastering checks are ready. Start creative work from the musical evidence.", href: createHref, label: "Create with this track" }
          : analysis.hasMusicMap && !analysis.isActive
            ? { title: "Master or mix this unreleased track", detail: "Creative assets start once this master has release context and approved sections. Until then, Ensemblis keeps the source independent instead of guessing where it belongs.", href: "#mastering", label: "Review mastering" }
            : analysis.isActive || ingestionActive
              ? { title: analysis.isRefreshing ? "Fresh pass in progress" : ingestionActive ? "Context is finishing automatically" : "Analysis is already moving", detail: analysis.isRefreshing ? "Keep using the verified analysis already on this track while Ensemblis refreshes it in the background." : ingestion.detail, href: "#intelligence", label: "View analysis" }
              : vaultTrack.audio_url
                ? { title: "Ensemblis owns the analysis", detail: ingestion.detail, href: "#intelligence", label: "View analysis status" }
                : { title: "Add the real master", detail: "Analysis stays empty until Ensemblis has source audio to hear.", href: href("/studio/music/import"), label: "Add mastered music" };

  return (
    <div className="studio-v2-page track-object-page">
      <AnalysisAutoRefresh active={analysis.isActive || ingestionActive} />
      <ObjectHeader
        backHref={release ? href(`/studio/releases/${release.id}`) : href("/studio/music")}
        backLabel={release?.title ?? "Music"}
        eyebrow="Track"
        title={vaultTrack.title}
        subtitle={`${duration(vaultTrack.duration_seconds)} · ${ingestion.label}`}
        imageUrl={release?.artwork_url}
        imageAlt={release?.cover_alt || (release ? `${release.title} artwork` : "")}
        facts={[
          ...(analysis.hasMusicMap ? [
            { label: "Structure", value: `${sections} section${sections === 1 ? "" : "s"}` },
            { label: "Best sections", value: `${Math.min(hooks, 5)} surfaced` },
          ] : []),
          ...(bpm ? [{ label: "Tempo", value: `${bpm} BPM` }] : []),
          ...(mastering ? [{ label: "Mastering", value: mastering }] : []),
        ]}
      />

      <section className="track-human-factors-source" aria-label="Track source">
        <span className="section-label">Source audio</span>
        <h2>{vaultTrack.audio_url ? "Canonical master" : "Master audio is still missing"}</h2>
        <p>{vaultTrack.notes || (vaultTrack.audio_url ? "The source Ensemblis uses for analysis, mastering and creative decisions." : "Add the mastered source before Ensemblis makes music-aware recommendations.")}</p>
        {vaultTrack.audio_url ? <TrackPreview src={vaultTrack.audio_url} label={`${vaultTrack.title} master`} /> : null}
      </section>

      <div className="track-human-factors-state">
        {vaultTrack.audio_url && analysis.isActive ? (
          <ProcessingState
            eyebrow={processing.eyebrow}
            title={processing.title}
            detail={processing.detail}
            steps={processing.steps}
            ariaLabel={`Track analysis. ${processing.title}`}
          />
        ) : ingestionActive ? (
          <ProcessingState
            eyebrow="Analysis · Context"
            title="Ensemblis is finishing the release context."
            detail={ingestion.detail}
            progress={ingestion.progress}
            steps={[
              { label: "Master attached", state: "complete" },
              { label: "Analysis", state: "complete" },
              { label: "Release context", state: "active" },
              { label: "Ready to use", state: "waiting" },
            ]}
            ariaLabel="Music ingestion. Ensemblis is finishing release context."
          />
        ) : (
          <ObjectStateSummary
            label={trackState.label}
            title={trackState.title}
            detail={trackState.detail}
            tone={trackState.tone}
          />
        )}
      </div>

      <div className="track-human-factors-recommendation">
        <NextActionWidget
          eyebrow="Next action"
          title={nextAction.title}
          detail={nextAction.detail}
          action={<Link className="button primary" href={nextAction.href}>{nextAction.label}</Link>}
        />
      </div>

      <div className="track-human-factors-actions">
        <ObjectActionBar actions={objectActions} />
      </div>

      <section className="track-object-section track-human-factors-summary" id="intelligence">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Analysis</span>
            <h2>What Ensemblis hears</h2>
            <p>{analysis.hasMusicMap ? `${sections} section${sections === 1 ? "" : "s"} · ${Math.min(hooks, 5)} strong section${Math.min(hooks, 5) === 1 ? "" : "s"}${bpm ? ` · ${bpm} BPM` : ""}. Open detail only when you need the underlying evidence.` : analysisNeedsRecovery ? "Verified results stay intact while you recover the failed analysis pass." : analysis.isActive || ingestionActive ? "Ensemblis is still listening. You can leave this page and return later." : "The analysis will appear automatically when the source is ready."}</p>
          </div>
        </div>

        {!analysis.hasMusicMap && !analysis.isActive && !analysisNeedsRecovery ? (
          <div className="v2-calm-state compact">
            <strong>{vaultTrack.audio_url ? "No action needed." : "No source audio yet."}</strong>
            <p>{vaultTrack.audio_url ? "Analysis starts automatically." : "Add a master first."}</p>
          </div>
        ) : null}

        <ContextInspector
          title="Full track analysis"
          description="Musical evidence, source information and technical analysis details for this track."
          triggerLabel="Technical details"
          triggerClassName="text-button"
        >
          {analysis.hasMusicMap ? <MusicIntelligencePreview audioUrl={vaultTrack.audio_url} musicMap={vaultTrack.audio_profile} /> : null}
          <dl className="track-object-advanced">
            <div><dt>Source</dt><dd>{titleCase(vaultTrack.source)}</dd></div>
            <div><dt>Analysis state</dt><dd>{titleCase(analysis.status)}</dd></div>
            <div><dt>Ingestion</dt><dd>{ingestion.label}</dd></div>
            <div><dt>Attempt</dt><dd>{analysis.attempt}</dd></div>
            <div><dt>Analysis model</dt><dd>{analysis.hasMusicMap ? `v${typeof musicMap.version === "number" ? musicMap.version : "?"}` : "Pending"}</dd></div>
            <div><dt>Media asset</dt><dd>{vaultTrack.media_asset_id ? "Connected" : "Legacy source"}</dd></div>
          </dl>
          {analysis.message ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.78rem" }}>{analysis.message}</pre> : null}
        </ContextInspector>

        {vaultTrack.audio_url && !analysis.isActive ? (
          <details className="track-object-advanced" id="analysis-recovery" open={analysisNeedsRecovery || undefined}>
            <summary>{analysisNeedsRecovery ? "Retry analysis" : "Analysis controls"}</summary>
            <p className="v2-muted-copy">{analysisNeedsRecovery ? "Analysis recovery retries only the analysis step. The canonical master and any verified results remain untouched until a new full result succeeds." : "Normal ingestion is automatic. Start a fresh analysis pass here only when you intentionally want to refresh or repair the current result."}</p>
            <form action={analyzeMusicTrack}>
              <input type="hidden" name="id" value={vaultTrack.id} />
              <AnalysisSubmitButton
                className={analysisNeedsRecovery ? "button primary" : "button"}
                idleLabel={analysis.actionLabel}
                pendingLabel={analysisNeedsRecovery ? "Retrying analysis…" : "Starting analysis…"}
              />
            </form>
          </details>
        ) : null}
      </section>

      <section className="track-object-section track-v5-mastering" id="mastering">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Mastering</span>
            <h2>{mastering ? `Master: ${mastering}` : "Check the master before release"}</h2>
            <p>Start with the release-readiness decision. Open the mastering workspace only when you want to change or inspect the sound.</p>
          </div>
        </div>
        {analysis.hasMusicMap ? (
          <>
            <MasterReadinessCard
              readiness={masterReadiness}
              audioUrl={vaultTrack.audio_url}
              continueHref={release ? href(`/studio/releases/${release.id}/distribution`) : null}
              replaceHref={release ? href(`/studio/releases/${release.id}?stage=overview#master-audio`) : href("/studio/music/import")}
            />
            <details
              className="track-v5-workspace"
              open={masterReadiness.status === "fix_required" || masterReadiness.status === "review" || undefined}
            >
              <summary>
                <strong>{masterReadiness.status === "fix_required" ? "Fix the master" : masterReadiness.status === "review" ? "Review mastering options" : "Open mastering workspace"}</strong>
                <span>Creative mastering, references, listening comparison and engineering detail</span>
              </summary>
              <div className="track-v5-workspace-body">
                <ActiveMasteringPanel
                  trackId={vaultTrack.id}
                  sourceAudioUrl={vaultTrack.audio_url}
                  readiness={masterReadiness}
                />
                <MasteringReferencesPanel
                  trackId={vaultTrack.id}
                  canAddCurrent={masterReadiness.status === "ready" || masterReadiness.status === "review"}
                />
                <ContextInspector
                  title="Mastering engineering details"
                  description="Measurements, comparison evidence and engineering diagnostics for the current master."
                  triggerLabel="Engineering details"
                  triggerClassName="button"
                >
                  <MasteringInspectorPanel
                    audioUrl={vaultTrack.audio_url}
                    musicMap={vaultTrack.audio_profile}
                    catalogProfiles={catalogProfiles}
                  />
                </ContextInspector>
              </div>
            </details>
          </>
        ) : (
          <div className="v2-calm-state compact">
            <strong>{vaultTrack.audio_url ? "The mastering check is part of the same analysis." : "No master to inspect yet."}</strong>
            <p>{vaultTrack.audio_url ? "It appears here when Ensemblis finishes listening." : "Add the canonical master first."}</p>
          </div>
        )}
      </section>

      {releaseTrack && release ? (
        <section className="track-v5-secondary-details track-human-factors-release" aria-label="Track source details">
          <details id="stems" open={ingestion.inputReason === "stems_from_previous_master" || undefined}>
            <summary>
              <strong>Stems</strong>
              <span>{ingestion.inputReason === "stems_from_previous_master" ? "Needs your attention" : "Open source and stem detail"}</span>
            </summary>
            <StemIntelligencePanel releaseId={release.id} track={releaseTrack} />
          </details>
          <details id="lyrics" open={ingestion.inputReason === "official_lyrics_missing" || ingestion.inputReason === "ai_context_disabled" || undefined}>
            <summary>
              <strong>Lyrics</strong>
              <span>{ingestion.inputReason === "official_lyrics_missing" || ingestion.inputReason === "ai_context_disabled" ? "Needs your attention" : "Open lyrics and permissions"}</span>
            </summary>
            <LyricsIntelligencePanel releaseId={release.id} track={releaseTrack} />
          </details>
        </section>
      ) : (
        <section className="track-object-section track-object-linked-context track-human-factors-release">
          <span className="section-label">Release context</span>
          <h2>{release ? "This legacy release link needs exact track source history before stems and lyrics can be shown safely." : "Stems and lyrics attach when this track becomes a release."}</h2>
          <p>{release ? "Ensemblis will not guess which song owns track-level derived material." : "The unreleased master stays independent until you make the release decision."}</p>
        </section>
      )}
    </div>
  );
}
