import Link from "next/link";
import { notFound } from "next/navigation";
import { analyzeMusicTrack } from "@/app/studio/growth-media-actions-safe";
import { ActiveMasteringPanel } from "@/components/studio/active-mastering-panel";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { AnalysisSubmitButton } from "@/components/studio/analysis-submit-button";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MasteringInspectorPanel } from "@/components/studio/mastering-inspector-panel";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ObjectHeader } from "@/components/studio/object-header";
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

export default async function TrackWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireStudioAdmin();
  const artist = await resolveActiveArtistContext(supabase, user);
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
  if (!vaultTrack) notFound();

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
        .order("is_primary", { ascending: false })
        .order("display_order", { ascending: true }),
    ]);
    if (releaseResult.error) throw new Error(releaseResult.error.message);
    if (tracksResult.error) throw new Error(tracksResult.error.message);
    release = releaseResult.data;
    releaseTrack = (tracksResult.data ?? []).find((track) => track.is_primary) ?? tracksResult.data?.[0] ?? null;
  }

  const analysis = describeTrackAnalysis(vaultTrack.analysis, vaultTrack.audio_profile);
  const analysisNeedsRecovery = analysis.needsRecovery;
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
  const intelligenceFact = analysis.isPartial
    ? "Partial"
    : analysis.hasMusicMap
      ? analysis.isRefreshing ? "Refreshing" : "Ready"
      : analysis.isActive
        ? "Listening"
        : analysisNeedsRecovery ? "Needs attention" : "Pending";

  return (
    <div className="studio-v2-page track-object-page">
      <AnalysisAutoRefresh active={analysis.isActive} />
      <ObjectHeader
        backHref={href("/studio/music")}
        backLabel="Music"
        eyebrow="Track"
        title={vaultTrack.title}
        subtitle={`${titleCase(vaultTrack.status)} · ${duration(vaultTrack.duration_seconds)} · ${vaultTrack.audio_url ? analysis.label : "Needs master"}`}
        imageUrl={release?.artwork_url}
        imageAlt={release?.cover_alt || (release ? `${release.title} artwork` : "")}
        facts={[
          { label: "Master", value: vaultTrack.audio_url ? "Ready" : "Missing" },
          { label: "Mastering", value: mastering ?? (analysis.hasMusicMap ? "Available" : "Pending") },
          { label: "Intelligence", value: intelligenceFact },
          { label: "Structure", value: analysis.hasMusicMap ? `${sections} section${sections === 1 ? "" : "s"}` : "Pending" },
          { label: "Strong moments", value: analysis.hasMusicMap ? `${Math.min(hooks, 5)} surfaced` : "Pending" },
          ...(bpm ? [{ label: "Tempo", value: `${bpm} BPM` }] : []),
        ]}
        actions={release
          ? <Link className="button primary" href={href(`/studio/releases/${release.id}`)}>Open release</Link>
          : analysis.hasMusicMap && !analysisNeedsRecovery
            ? <Link className="button primary" href={createHref}>Create from this track</Link>
            : <Link className="button" href="#intelligence">Track Intelligence</Link>}
        tabs={tabs}
      />

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
          ) : vaultTrack.audio_url ? (
            <>
              <strong>No action needed</strong>
              <p>{analysis.hasMusicMap ? "Ensemblis is refreshing the full pass while keeping the current verified intelligence available." : "Ensemblis is preparing musical understanding, mastering checks and beat stability automatically."}</p>
              <Link href={href("/studio/music")}>Back to Music →</Link>
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
            <h2>{analysis.isPartial ? "Verified intelligence, full pass needs recovery" : analysis.isRefreshing ? "Current intelligence while Ensemblis refreshes" : analysis.hasMusicMap ? "What Ensemblis hears" : analysisNeedsRecovery ? "Understanding needs recovery" : "Ensemblis is understanding the track"}</h2>
          </div>
          {vaultTrack.audio_url ? <span className="growth-active-label">{analysis.label}</span> : null}
        </div>

        {analysis.hasMusicMap ? (
          <MusicIntelligencePreview audioUrl={vaultTrack.audio_url} musicMap={vaultTrack.audio_profile} />
        ) : null}

        {analysis.isRefreshing ? (
          <div className="v2-calm-state compact">
            <strong>Refreshing full intelligence.</strong>
            <p>The current verified results stay available while the free Media Worker runs. They are replaced only after a complete result returns.</p>
          </div>
        ) : analysis.isPartial ? (
          <div className="v2-calm-state compact">
            <strong>Partial does not mean lost.</strong>
            <p>{analysis.failureCopy}</p>
          </div>
        ) : !analysis.hasMusicMap ? (
          <div className="v2-calm-state compact">
            <strong>{analysisNeedsRecovery ? "The source master is safe." : analysis.isActive ? "Nothing to fill in manually." : vaultTrack.audio_url ? "Master ready for analysis." : "No source audio yet."}</strong>
            <p>{analysisNeedsRecovery ? analysis.failureCopy : analysis.isActive ? "Structure and strongest Moments appear here automatically when analysis completes." : vaultTrack.audio_url ? "Run Track Intelligence to generate music-aware structure, Moments and mastering checks." : "Add a master first."}</p>
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
          <h2>Stems and lyrics attach when this track becomes a release.</h2>
          <p>The unreleased master stays independent until you make the release decision.</p>
        </section>
      )}
    </div>
  );
}
