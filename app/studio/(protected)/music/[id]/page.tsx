import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { analyzeMusicTrack } from "@/app/studio/growth-media-actions-safe";
import { ActiveMasteringPanel } from "@/components/studio/active-mastering-panel";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { AnalysisSubmitButton } from "@/components/studio/analysis-submit-button";
import { CatalogTrackWorkspace } from "@/components/studio/catalog-track-workspace";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MasteringInspectorPanel } from "@/components/studio/mastering-inspector-panel";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ObjectHeader } from "@/components/studio/object-header";
import { ProcessingState } from "@/components/studio/processing-state";
import { StemIntelligencePanel } from "@/components/studio/stem-intelligence-panel";
import { TrackPreview } from "@/components/studio/track-preview";
import { requireStudioAdmin } from "@/lib/auth/studio";
import { ensemblisArtistHref } from "@/lib/ensemblis-product";
import { resolveActiveArtistContext } from "@/lib/studio/artist-context";
import { asGrowthClient } from "@/lib/studio/growth-db";
import { asArtistScopedMusicClient } from "@/lib/studio/music-db";
import { describeTrackAnalysis, hasMusicIntelligenceMap } from "@/lib/studio/track-analysis-state";
import type { Json, Track } from "@/types/database";

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

function masteringStatus(value: unknown) {
  const inspector = asRecord(asRecord(value).mastering_inspector);
  const status = inspector.status;
  if (status === "fix_before_release") return "Fix before release";
  if (status === "ready_review_suggested") return "Review suggested";
  if (status === "ready") return "Ready";
  return null;
}

function describeAnalysisProcessing(status: string, isRefreshing: boolean) {
  const isListening = status === "dispatched" || status === "running";

  if (isListening) {
    return {
      stage: "analyzing" as const,
      title: isRefreshing ? "Refreshing what Ensemblis hears." : "Ensemblis is understanding your track.",
      copy: isRefreshing
        ? "Current verified intelligence stays available while Ensemblis listens again for structure, tempo, strongest Moments and mastering signals."
        : "Ensemblis is listening for structure, tempo, strongest Moments and mastering signals. Deep audio passes can take several minutes.",
    };
  }

  if (status === "queued") {
    return {
      stage: "preparing" as const,
      title: isRefreshing ? "Your fresh intelligence pass is queued." : "Track Intelligence is queued.",
      copy: isRefreshing
        ? "Current verified intelligence stays live while the Media Worker waits for capacity to start the fresh pass."
        : "The master is safe and waiting for the Media Worker. Analysis starts automatically when the worker is available.",
    };
  }

  return {
    stage: "preparing" as const,
    title: isRefreshing ? "Preparing a fresh intelligence pass." : "Preparing Track Intelligence.",
    copy: isRefreshing
      ? "Nothing is being replaced yet. Current verified intelligence remains live while Ensemblis prepares the new pass."
      : "The master is attached. Ensemblis is preparing the analysis job automatically.",
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

  const { data: catalogTracks, error: catalogError } = await growth
    .from("track_vault")
    .select("id,title,audio_profile")
    .eq("owner_id", user.id)
    .eq("artist_id", artist.artistId)
    .neq("id", id)
    .limit(24);
  if (catalogError) throw new Error(catalogError.message);

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
  const analysisNeedsRecovery = analysis.needsRecovery;
  const processing = describeAnalysisProcessing(analysis.status, analysis.isRefreshing);
  const musicMap = asRecord(vaultTrack.audio_profile);
  const sections = Array.isArray(musicMap.sections) ? musicMap.sections.length : 0;
  const hooks = Array.isArray(musicMap.hook_candidates) ? musicMap.hook_candidates.length : 0;
  const bpm = typeof musicMap.bpm === "number" && Number.isFinite(musicMap.bpm) ? Math.round(musicMap.bpm) : null;
  const mastering = masteringStatus(vaultTrack.audio_profile);
  const createHref = href(`/studio/create?intent=asset&track=${vaultTrack.id}`);
  const tabs = [
    { label: "Overview", href: "#overview", active: true },
    { label: "Intelligence", href: "#intelligence" },
    { label: "Mastering", href: "#mastering" },
    ...(releaseTrack ? [{ label: "Stems", href: "#stems" }, { label: "Lyrics", href: "#lyrics" }] : []),
  ];
  const catalogProfiles = (catalogTracks ?? [])
    .filter((track) => hasMusicIntelligenceMap(track.audio_profile))
    .map((track) => ({ title: track.title, musicMap: track.audio_profile as Json }));

  return (
    <div className="studio-v2-page track-object-page">
      <AnalysisAutoRefresh active={analysis.isActive} />
      <ObjectHeader
        backHref={release ? href(`/studio/releases/${release.id}`) : href("/studio/music")}
        backLabel={release?.title ?? "Music"}
        eyebrow="Track"
        title={vaultTrack.title}
        subtitle={`${duration(vaultTrack.duration_seconds)} · ${vaultTrack.audio_url ? "Master attached" : "Master required"}`}
        imageUrl={release?.artwork_url}
        imageAlt={release?.cover_alt || (release ? `${release.title} artwork` : "")}
        facts={[
          ...(analysis.hasMusicMap ? [
            { label: "Structure", value: `${sections} section${sections === 1 ? "" : "s"}` },
            { label: "Strong moments", value: `${Math.min(hooks, 5)} surfaced` },
          ] : []),
          ...(bpm ? [{ label: "Tempo", value: `${bpm} BPM` }] : []),
          ...(mastering ? [{ label: "Mastering", value: mastering }] : []),
        ]}
        actions={release
          ? <Link className="button primary" href={href(`/studio/releases/${release.id}`)}>Open release</Link>
          : !vaultTrack.audio_url
            ? <Link className="button primary" href={href("/studio/music/import")}>Add master</Link>
            : analysisNeedsRecovery
              ? <Link className="button primary" href="#analysis-recovery">Retry intelligence</Link>
              : analysis.hasMusicMap && !analysis.isActive
                ? <Link className="button primary" href={createHref}>Create from this track</Link>
                : !analysis.isActive
                  ? <Link className="button" href="#analysis-recovery">Run Track Intelligence</Link>
                  : undefined}
        tabs={tabs}
      />

      {vaultTrack.audio_url && analysis.isActive ? (
        <ProcessingState
          stage={processing.stage}
          title={processing.title}
          copy={processing.copy}
          aside={analysis.isRefreshing ? <span className="growth-active-label">Current intelligence stays live</span> : undefined}
        />
      ) : null}

      <section className="track-object-overview" id="overview">
        <div className="track-object-primary">
          <span className="section-label">Source audio</span>
          <h2>{vaultTrack.audio_url ? "Canonical master" : "Master audio is still missing"}</h2>
          {vaultTrack.notes ? <p>{vaultTrack.notes}</p> : <p>{vaultTrack.audio_url ? "The source Ensemblis uses for structure, mastering QA, beat stability and strongest Moments." : "Ensemblis needs the mastered source before it can make music-aware recommendations."}</p>}
          {vaultTrack.audio_url ? <TrackPreview src={vaultTrack.audio_url} label={`${vaultTrack.title} master`} /> : null}
        </div>
        <aside className="track-object-decision">
          <span className="section-label">Recommended next move</span>
          {analysisNeedsRecovery ? (
            <>
              <strong>{analysis.isPartial ? "Finish the full intelligence pass" : "Analysis needs attention"}</strong>
              <p>{analysis.isPartial ? "Verified results are still available, but the latest full pass stopped before completion." : "The master is safe. Retry only the intelligence step."}</p>
              <Link href="#analysis-recovery">Open recovery →</Link>
            </>
          ) : mastering === "Fix before release" ? (
            <>
              <strong>Fix the mastering blocker first</strong>
              <p>Mastering Inspector found a technical issue that should be corrected before distribution.</p>
              <Link href="#mastering">Review mastering →</Link>
            </>
          ) : analysis.hasMusicMap && !analysis.isActive ? (
            <>
              <strong>Create from the strongest Moment</strong>
              <p>Track Intelligence and mastering checks are ready. Start creative work from the musical evidence.</p>
              <Link href={createHref}>Create with this track →</Link>
            </>
          ) : analysis.isActive ? (
            <>
              <strong>{analysis.isRefreshing ? "Fresh pass in progress" : "Analysis is already moving"}</strong>
              <p>{analysis.isRefreshing ? "Keep using the verified intelligence already on this track while Ensemblis refreshes it in the background." : "Ensemblis is processing the master automatically. You do not need to start or babysit anything."}</p>
              <Link href="#intelligence">View Track Intelligence →</Link>
            </>
          ) : vaultTrack.audio_url ? (
            <>
              <strong>Ready when you are</strong>
              <p>The master is attached. Run Track Intelligence when you want structure, strong Moments and mastering checks.</p>
              <Link href="#analysis-recovery">Open analysis controls →</Link>
            </>
          ) : (
            <>
              <strong>Add the real master</strong>
              <p>Music intelligence stays empty until Ensemblis has source audio to hear.</p>
              <Link href={href("/studio/music/import")}>Add mastered music →</Link>
            </>
          )}
        </aside>
      </section>

      <section className="track-object-section" id="intelligence">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Track Intelligence</span>
            <h2>{analysis.isPartial ? "Verified intelligence remains available" : analysis.isRefreshing ? "Current intelligence while Ensemblis refreshes" : analysis.hasMusicMap ? "What Ensemblis hears" : analysisNeedsRecovery ? "Understanding needs recovery" : analysis.isActive ? "Analysis in progress" : "Understand this track"}</h2>
          </div>
        </div>

        {analysis.hasMusicMap ? (
          <MusicIntelligencePreview audioUrl={vaultTrack.audio_url} musicMap={vaultTrack.audio_profile} />
        ) : null}

        {!analysis.hasMusicMap && !analysis.isActive && !analysisNeedsRecovery ? (
          <div className="v2-calm-state compact">
            <strong>{vaultTrack.audio_url ? "Master ready for analysis." : "No source audio yet."}</strong>
            <p>{vaultTrack.audio_url ? "Run Track Intelligence to generate music-aware structure, Moments and mastering checks." : "Add a master first."}</p>
          </div>
        ) : null}

        <details className="track-object-advanced">
          <summary>Technical details</summary>
          <dl>
            <div><dt>Source</dt><dd>{titleCase(vaultTrack.source)}</dd></div>
            <div><dt>Analysis state</dt><dd>{titleCase(analysis.status)}</dd></div>
            <div><dt>Attempt</dt><dd>{analysis.attempt}</dd></div>
            <div><dt>Music map</dt><dd>{analysis.hasMusicMap ? `v${typeof musicMap.version === "number" ? musicMap.version : "?"}` : "Pending"}</dd></div>
            <div><dt>Media asset</dt><dd>{vaultTrack.media_asset_id ? "Connected" : "Legacy source"}</dd></div>
          </dl>
          {analysis.message ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.78rem" }}>{analysis.message}</pre> : null}
        </details>

        {vaultTrack.audio_url && !analysis.isActive ? (
          <details className="track-object-advanced" id="analysis-recovery" open={analysisNeedsRecovery || undefined}>
            <summary>{analysisNeedsRecovery ? "Retry Track Intelligence" : "Analysis controls"}</summary>
            <p className="v2-muted-copy">{analysisNeedsRecovery ? "Analysis recovery retries only the intelligence step. The canonical master and any verified results remain untouched until a new full result succeeds." : "Re-run Track Intelligence only when you intentionally want a fresh pass. The canonical master stays unchanged."}</p>
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

      <section className="track-object-section" id="mastering">
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Mastering</span>
            <h2>Improve, verify and prepare the track for release</h2>
          </div>
        </div>
        {analysis.hasMusicMap ? (
          <>
            <ActiveMasteringPanel trackId={vaultTrack.id} sourceAudioUrl={vaultTrack.audio_url} />
            <MasteringInspectorPanel
              audioUrl={vaultTrack.audio_url}
              musicMap={vaultTrack.audio_profile}
              catalogProfiles={catalogProfiles}
            />
          </>
        ) : (
          <div className="v2-calm-state compact">
            <strong>{vaultTrack.audio_url ? "Mastering checks are part of the same analysis." : "No master to inspect yet."}</strong>
            <p>{vaultTrack.audio_url ? "They appear here when Ensemblis finishes listening." : "Add the canonical master first."}</p>
          </div>
        )}
      </section>

      {releaseTrack && release ? (
        <>
          <div className="track-object-section" id="stems"><StemIntelligencePanel releaseId={release.id} track={releaseTrack} /></div>
          <div className="track-object-section" id="lyrics"><LyricsIntelligencePanel releaseId={release.id} track={releaseTrack} /></div>
        </>
      ) : (
        <section className="track-object-section track-object-linked-context">
          <span className="section-label">Release context</span>
          <h2>{release ? "This legacy release link needs exact track lineage before stems and lyrics can be shown safely." : "Stems and lyrics attach when this track becomes a release."}</h2>
          <p>{release ? "Ensemblis will not guess which song owns track-level derived material." : "The unreleased master stays independent until you make the release decision."}</p>
        </section>
      )}
    </div>
  );
}
