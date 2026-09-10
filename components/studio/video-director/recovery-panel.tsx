import Link from "next/link";
import { useFallbackMusicAnalysis } from "@/app/studio/video-pipeline-actions";
import { SubmitButton } from "@/components/studio/submit-button";
import type { VideoWorkspaceData } from "./workspace-types";

export function RecoveryPanel({ data }: { data: VideoWorkspaceData }) {
  if (data.project.status !== "blocked" && data.project.status !== "failed") return null;
  const analysisFailure = data.project.previous_status === "analyzing_audio";
  return (
    <section className="video-recovery-panel" role="alert">
      <div>
        <span className="section-label">Safe recovery</span>
        <h2>{analysisFailure ? "Audio analysis could not finish" : "Production is paused"}</h2>
        <p>{data.project.last_error || "Atlas stopped before continuing into an unsafe or invalid state."}</p>
      </div>
      <div className="video-recovery-actions">
        {analysisFailure && data.track.duration ? (
          <form action={useFallbackMusicAnalysis}>
            <input type="hidden" name="project_id" value={data.project.id} />
            <SubmitButton pendingLabel="Creating estimated map...">Use estimated music structure</SubmitButton>
          </form>
        ) : null}
        <Link className="button" href={`/studio/video/${data.project.id}`}>Retry current view</Link>
      </div>
      {analysisFailure ? <small>The fallback is clearly labeled as estimated and can be replaced by real audio analysis later.</small> : null}
    </section>
  );
}
