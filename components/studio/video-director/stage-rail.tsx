import {
  VIDEO_PROJECT_STAGES,
  type VideoProjectStatus,
} from "@/lib/video-director/domain";
import { projectStageForStatus } from "@/lib/video-director/state";

export function StageRail({ status }: { status: VideoProjectStatus }) {
  const activeStage = projectStageForStatus(status);
  const activeIndex = VIDEO_PROJECT_STAGES.findIndex((stage) => stage.key === activeStage);

  return (
    <nav className="video-stage-rail" aria-label="Music video production stages">
      {VIDEO_PROJECT_STAGES.map((stage, index) => {
        const state = index < activeIndex ? "complete" : index === activeIndex ? "active" : "locked";
        return (
          <div className={`video-stage ${state}`} key={stage.key}>
            <span className="video-stage-index">{index < activeIndex ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <span>
              <strong>{stage.label}</strong>
              <small>{state === "active" ? "Current stage" : state === "complete" ? "Complete" : "Not available yet"}</small>
            </span>
          </div>
        );
      })}
    </nav>
  );
}
