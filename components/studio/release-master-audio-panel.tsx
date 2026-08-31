import { analyzeVaultTrack } from "@/app/studio/growth-media-actions";
import { MediaUploader } from "@/components/studio/media-uploader";
import { MusicIntelligencePreview } from "@/components/studio/music-intelligence-preview";
import type { Track } from "@/types/database";
import type { VaultTrack } from "@/types/growth-database";

function analysisState(value: VaultTrack["analysis"] | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "not_analyzed", message: "" };
  const record = value as Record<string, unknown>;
  return {
    status: typeof record.status === "string" ? record.status : "not_analyzed",
    message: typeof record.message === "string" ? record.message : "",
  };
}

function duration(seconds: number | null | undefined) {
  if (!seconds) return "Duration pending";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: string) {
  if (status === "queued" || status === "pending") return "Analyzing";
  if (status === "completed" || status === "ready" || status === "analyzed") return "Intelligence ready";
  if (status === "failed") return "Analysis failed";
  if (status === "unavailable") return "Worker unavailable";
  return "Master attached";
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
  const analysis = analysisState(vaultTrack?.analysis);
  const hasMaster = Boolean(audioUrl);
  const hasMusicMap = Boolean(
    vaultTrack?.audio_profile &&
    typeof vaultTrack.audio_profile === "object" &&
    !Array.isArray(vaultTrack.audio_profile) &&
    Object.keys(vaultTrack.audio_profile).length,
  );

  return (
    <section className="v2-section v2-full-column" id="master-audio">
      <div className="v2-section-heading">
        <div>
          <span className="section-label">Master & Music Intelligence</span>
          <h2>{hasMaster ? primaryTrack?.title || vaultTrack?.title || "Release master" : "Add the audio Atlas should understand"}</h2>
        </div>
        <span className={`v2-count ${hasMaster ? "" : "has-items"}`}>{hasMaster ? statusLabel(analysis.status) : "Missing"}</span>
      </div>

      {!hasMaster ? (
        <>
          <p className="v2-muted-copy">Upload the canonical master here. Atlas will keep it with this release, add it to Media Library, and automatically map the track structure and strongest hook candidates for video and campaign creation.</p>
          <MediaUploader releaseId={releaseId} defaultRole="master_audio" releaseMasterMode />
        </>
      ) : (
        <>
          <div className="growth-action-note">
            <strong>Canonical master</strong>
            <span>{duration(currentDuration)} · attached to this release · reusable across Atlas</span>
          </div>
          <audio controls preload="metadata" src={audioUrl ?? undefined} style={{ width: "100%" }} />

          {hasMusicMap && vaultTrack ? (
            <MusicIntelligencePreview audioUrl={audioUrl} musicMap={vaultTrack.audio_profile} />
          ) : analysis.status === "queued" || analysis.status === "pending" ? (
            <div className="v2-calm-state compact"><strong>Atlas is analyzing the master.</strong><p>Structure, sections and ranked hook candidates will appear here as soon as the media worker finishes.</p></div>
          ) : analysis.status === "failed" ? (
            <div className="notice">Music Intelligence could not finish this analysis{analysis.message ? `: ${analysis.message}` : "."}</div>
          ) : analysis.status === "unavailable" ? (
            <div className="notice">The master is safely attached, but the Media Worker is not configured in this environment. Analysis can be run once the worker is available.</div>
          ) : (
            <div className="v2-calm-state compact"><strong>Master attached, intelligence not generated yet.</strong><p>Run the analysis to map sections and rank the strongest hook windows.</p></div>
          )}

          <div className="actions">
            {vaultTrack && analysis.status !== "queued" && analysis.status !== "pending" ? (
              <form action={analyzeVaultTrack}>
                <input type="hidden" name="id" value={vaultTrack.id} />
                <button className="button" type="submit">Re-analyze master</button>
              </form>
            ) : null}
            <details className="workspace-drawer">
              <summary>Replace master audio</summary>
              <p className="v2-muted-copy">The new file becomes the canonical master and gets a fresh analysis. The previous asset remains in Media Library history instead of being deleted.</p>
              <MediaUploader releaseId={releaseId} defaultRole="master_audio" releaseMasterMode />
            </details>
          </div>
        </>
      )}
    </section>
  );
}
