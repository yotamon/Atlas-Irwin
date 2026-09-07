import { analyzeReleaseVaultTrack } from "@/app/studio/growth-media-actions-safe";
import { AnalysisAutoRefresh } from "@/components/studio/analysis-auto-refresh";
import { AnalysisSubmitButton } from "@/components/studio/analysis-submit-button";
import { LyricsIntelligencePanel } from "@/components/studio/lyrics-intelligence-panel";
import { MediaUploader } from "@/components/studio/media-uploader";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import { ReleaseMasteringPanel } from "@/components/studio/release-mastering-panel";
import { StemIntelligencePanel } from "@/components/studio/stem-intelligence-panel";
import { describeTrackAnalysis } from "@/lib/studio/track-analysis-state";
import type { Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function duration(seconds: number | null | undefined) {
  if (!seconds) return "Duration pending";
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

export function ReleaseMasterAudioPanel({
  releaseId,
  primaryTrack,
  vaultTrack,
}: {
  releaseId: string;
  primaryTrack: Track | null;
  vaultTrack: VaultTrack | null;
}) {
  const audioUrl = vaultTrack?.audio_url ?? primaryTrack?.audio_url ?? null;
  const currentDuration = vaultTrack?.duration_seconds ?? primaryTrack?.duration ?? null;
  const hasMaster = Boolean(audioUrl);
  const analysis = describeTrackAnalysis(vaultTrack?.analysis, vaultTrack?.audio_profile);
  const analysisFailureCopy = analysis.failureCopy;

  return (
    <>
      <section className="v2-section v2-full-column" id="master-audio">
        <AnalysisAutoRefresh active={analysis.isActive} />
        <div className="v2-section-heading">
          <div>
            <span className="section-label">Master & Music Intelligence</span>
            <h2>{hasMaster ? primaryTrack?.title || vaultTrack?.title || "Release master" : "Add the audio Ensemblis should understand"}</h2>
          </div>
          <span className={hasMaster ? "growth-active-label" : "v2-count has-items"}>{hasMaster ? analysis.label : "Missing"}</span>
        </div>

        {!hasMaster ? (
          <>
            <p className="v2-muted-copy">Upload the canonical master here. Ensemblis will keep it with this release, add it to Media Library, and automatically map the track structure and strongest hook candidates for video and campaign creation.</p>
            <MediaUploader releaseId={releaseId} defaultRole="master_audio" releaseMasterMode />
          </>
        ) : (
          <>
            <div className="growth-action-note">
              <strong>Canonical master</strong>
              <span>{duration(currentDuration)} · attached to this release · reusable across Ensemblis</span>
            </div>
            <audio controls preload="metadata" src={audioUrl ?? undefined} style={{ width: "100%" }} />

            {analysis.hasMusicMap && vaultTrack ? (
              <MusicIntelligencePreview audioUrl={audioUrl} musicMap={vaultTrack.audio_profile} />
            ) : null}

            {analysis.isRefreshing ? (
              <div className="v2-calm-state compact">
                <strong>Refreshing full intelligence.</strong>
                <p>The verified results above stay available while the new pass runs. Ensemblis will replace them only after a complete result returns.</p>
              </div>
            ) : analysis.isPartial ? (
              <div className="v2-calm-state compact" id="analysis-recovery">
                <strong>Verified results are still available.</strong>
                <p>{analysisFailureCopy}</p>
              </div>
            ) : !analysis.hasMusicMap && analysis.isActive ? (
              <div className="v2-calm-state compact">
                <strong>{analysis.status === "pending" || analysis.status === "queued" ? "Analysis is queued." : "Ensemblis is analyzing the master."}</strong>
                <p>Structure, sections, mastering checks and ranked Moments will appear here automatically. You can leave this page while the free Media Worker runs.</p>
              </div>
            ) : !analysis.hasMusicMap && analysis.needsRecovery ? (
              <div className="notice" id="analysis-recovery">{analysisFailureCopy}</div>
            ) : !analysis.hasMusicMap ? (
              <div className="v2-calm-state compact"><strong>Master attached, intelligence not generated yet.</strong><p>Run the analysis to map sections, mastering checks and the strongest Moment windows.</p></div>
            ) : null}

            {vaultTrack && !analysis.isActive ? (
              <div className="actions">
                <form action={analyzeReleaseVaultTrack}>
                  <input type="hidden" name="id" value={vaultTrack.id} />
                  <input type="hidden" name="release_id" value={releaseId} />
                  <AnalysisSubmitButton
                    className={analysis.needsRecovery ? "button primary" : "button"}
                    idleLabel={analysis.actionLabel}
                    pendingLabel={analysis.needsRecovery ? "Retrying analysis…" : "Starting analysis…"}
                  />
                </form>
              </div>
            ) : null}

            {analysis.message ? (
              <details className="workspace-drawer">
                <summary>Technical diagnostics</summary>
                <p className="v2-muted-copy">Analysis attempt {analysis.attempt}. This diagnostic is for troubleshooting only; the master file is not affected.</p>
                <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.78rem" }}>{analysis.message}</pre>
              </details>
            ) : null}

            <details className="workspace-drawer">
              <summary>Replace master audio</summary>
              <p className="v2-muted-copy">The new file becomes the canonical master and gets a fresh analysis. The previous asset remains in Media Library history instead of being deleted.</p>
              <MediaUploader releaseId={releaseId} defaultRole="master_audio" releaseMasterMode />
            </details>
          </>
        )}
      </section>

      {analysis.hasMusicMap && vaultTrack ? <ReleaseMasteringPanel vaultTrack={vaultTrack} /> : null}

      <StemIntelligencePanel releaseId={releaseId} track={primaryTrack} />
      <LyricsIntelligencePanel releaseId={releaseId} track={primaryTrack} />
    </>
  );
}
